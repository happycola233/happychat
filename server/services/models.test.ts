import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let modelServices: typeof import('./models')
let fixtureSeq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-model-access-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-model-access'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  modelServices = await import('./models')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createFixture(options: { sort?: number; kind?: 'responses' | 'image' } = {}) {
  const n = fixtureSeq++
  const adminId = `model-access-admin-${n}`
  const userId = `model-access-user-${n}`
  const providerId = `model-access-provider-${n}`
  const modelId = `model-access-model-${n}`

  await dbClient.db.insert(schema.users).values([
    {
      id: adminId,
      username: `model-access-admin-${n}`,
      passwordHash: 'hash',
      role: 'admin',
    },
    {
      id: userId,
      username: `model-access-user-${n}`,
      passwordHash: 'hash',
      role: 'user',
    },
  ])
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: `upstream-model-${n}`,
    displayName: `Model ${n}`,
    kind: options.kind ?? 'responses',
    sort: options.sort ?? n * 100,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      image_generation: options.kind === 'image',
      reasoning: false,
    },
  })

  return { adminId, userId, providerId, modelId }
}

describe('model user access', () => {
  it('keeps replay configuration private to the administrator model DTO', async () => {
    const fixture = await createFixture()
    await dbClient.db
      .update(schema.models)
      .set({ replayReasoning: true })
      .where(eq(schema.models.id, fixture.modelId))

    const publicModel = (await modelServices.listEnabledModels(fixture.userId)).find(
      (model) => model.id === fixture.modelId,
    )
    const adminModel = (await modelServices.listAdminModels()).find(
      (model) => model.id === fixture.modelId,
    )

    expect(publicModel).toBeDefined()
    expect(publicModel).not.toHaveProperty('replayReasoning')
    expect(adminModel?.replayReasoning).toBe(true)
  })

  it('persists the explicit replay setting when an administrator creates a model', async () => {
    const fixture = await createFixture()
    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: `created-upstream-${fixtureSeq}`,
      displayName: 'Created replay model',
      tags: [],
      kind: 'responses',
      enabled: true,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'medium', description: '中等' }],
      replayReasoning: true,
      defaultWebSearch: false,
      sort: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.replayReasoning).toBe(true)
    const [stored] = await dbClient.db
      .select({ replayReasoning: schema.models.replayReasoning })
      .from(schema.models)
      .where(eq(schema.models.id, result.model.id))
    expect(stored?.replayReasoning).toBe(true)
  })

  it('keeps existing and newly inserted models available to all users by default', async () => {
    const fixture = await createFixture()

    const adminModels = await modelServices.listEnabledModels(fixture.adminId)
    const userModels = await modelServices.listEnabledModels(fixture.userId)
    expect(adminModels.some((model) => model.id === fixture.modelId)).toBe(true)
    expect(userModels.some((model) => model.id === fixture.modelId)).toBe(true)
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.adminId)).not.toBeNull()
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).not.toBeNull()
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'all',
      userIds: [],
    })
  })

  it('does not grant administrators an implicit user-side bypass', async () => {
    const fixture = await createFixture()
    const updated = await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId],
    })

    expect(updated).toEqual({
      ok: true,
      access: { accessMode: 'selected', userIds: [fixture.userId] },
    })
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).not.toBeNull()
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.adminId)).toBeNull()
    expect(
      (await modelServices.listEnabledModels(fixture.adminId)).some(
        (model) => model.id === fixture.modelId,
      ),
    ).toBe(false)

    const adminModel = (await modelServices.listAdminModels()).find(
      (model) => model.id === fixture.modelId,
    )
    expect(adminModel).toMatchObject({ accessMode: 'selected', allowedUserCount: 1 })
  })

  it('keeps global model and provider switches above the preserved user policy', async () => {
    const fixture = await createFixture()
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId],
    })

    await dbClient.db
      .update(schema.models)
      .set({ enabled: false })
      .where(eq(schema.models.id, fixture.modelId))
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).toBeNull()
    await dbClient.db
      .update(schema.models)
      .set({ enabled: true })
      .where(eq(schema.models.id, fixture.modelId))

    await dbClient.db
      .update(schema.providers)
      .set({ enabled: false })
      .where(eq(schema.providers.id, fixture.providerId))
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).toBeNull()
    await dbClient.db
      .update(schema.providers)
      .set({ enabled: true })
      .where(eq(schema.providers.id, fixture.providerId))

    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).not.toBeNull()
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'selected',
      userIds: [fixture.userId],
    })
  })

  it('rejects unknown users without partially changing the access policy', async () => {
    const fixture = await createFixture()
    const result = await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId, 'deleted-user'],
    })

    expect(result).toEqual({
      ok: false,
      code: 'unknown_users',
      unknownUserIds: ['deleted-user'],
    })
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'all',
      userIds: [],
    })
    const rows = await dbClient.db
      .select()
      .from(schema.modelUserAccess)
      .where(eq(schema.modelUserAccess.modelId, fixture.modelId))
    expect(rows).toEqual([])
  })

  it('replaces the full list, preserves deny-all, and clears rows when switching to all', async () => {
    const fixture = await createFixture()
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.adminId, fixture.userId],
    })
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId],
    })
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'selected',
      userIds: [fixture.userId],
    })

    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [],
    })
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.userId)).toBeNull()
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'selected',
      userIds: [],
    })

    // all 模式会先忽略客户端残留名单，因此其中的未知 ID 也不会阻止清空关联行。
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'all',
      userIds: ['deleted-user'],
    })
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'all',
      userIds: [],
    })
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.adminId)).not.toBeNull()
    const rows = await dbClient.db
      .select()
      .from(schema.modelUserAccess)
      .where(eq(schema.modelUserAccess.modelId, fixture.modelId))
    expect(rows).toEqual([])
  })

  it('cascades deleted users and models without turning selected mode into all', async () => {
    const fixture = await createFixture()
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId],
    })

    await dbClient.db.delete(schema.users).where(eq(schema.users.id, fixture.userId))
    expect(await modelServices.getModelAccess(fixture.modelId)).toEqual({
      accessMode: 'selected',
      userIds: [],
    })
    expect(await modelServices.getRunnableModel(fixture.modelId, fixture.adminId)).toBeNull()

    await dbClient.db.delete(schema.models).where(eq(schema.models.id, fixture.modelId))
    const rows = await dbClient.db
      .select()
      .from(schema.modelUserAccess)
      .where(eq(schema.modelUserAccess.modelId, fixture.modelId))
    expect(rows).toEqual([])
  })

  it('stores a selection larger than one insert batch', async () => {
    const fixture = await createFixture()
    const userIds = Array.from(
      { length: 251 },
      (_, index) => `model-access-batch-user-${fixtureSeq}-${index}`,
    )
    for (let offset = 0; offset < userIds.length; offset += 100) {
      await dbClient.db.insert(schema.users).values(
        userIds.slice(offset, offset + 100).map((id) => ({
          id,
          username: id,
          passwordHash: 'hash',
        })),
      )
    }

    const result = await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds,
    })

    expect(result.ok).toBe(true)
    expect((await modelServices.getModelAccess(fixture.modelId))?.userIds).toHaveLength(251)
    const adminModel = (await modelServices.listAdminModels()).find(
      (model) => model.id === fixture.modelId,
    )
    expect(adminModel?.allowedUserCount).toBe(251)
  })

  it('uses the same user filter for the title-model text fallback', async () => {
    const fixture = await createFixture({ sort: -1_000_000 })
    await modelServices.updateModelAccess(fixture.modelId, {
      accessMode: 'selected',
      userIds: [fixture.userId],
    })

    expect((await modelServices.getFirstRunnableTextModel(fixture.userId))?.model.id).toBe(
      fixture.modelId,
    )
    expect((await modelServices.getFirstRunnableTextModel(fixture.adminId))?.model.id).not.toBe(
      fixture.modelId,
    )
  })
})
