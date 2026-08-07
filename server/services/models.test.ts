import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let modelServices: typeof import('./models')
let providerServices: typeof import('./providers')
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
  providerServices = await import('./providers')
  migration.runMigrations()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createFixture(
  options: {
    sort?: number
    kind?: 'responses' | 'chat' | 'anthropic' | 'image'
    protocol?: 'openai' | 'anthropic'
  } = {},
) {
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
    protocol: options.protocol ?? 'openai',
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
      x_search: false,
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
      .set({ replayProviderContext: true })
      .where(eq(schema.models.id, fixture.modelId))

    const publicModel = (await modelServices.listEnabledModels(fixture.userId)).find(
      (model) => model.id === fixture.modelId,
    )
    const adminModel = (await modelServices.listAdminModels()).find(
      (model) => model.id === fixture.modelId,
    )

    expect(publicModel).toBeDefined()
    expect(publicModel).not.toHaveProperty('replayProviderContext')
    expect(adminModel?.replayProviderContext).toBe(true)
  })

  it('persists the explicit replay setting when an administrator creates a model', async () => {
    const fixture = await createFixture()
    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: `created-upstream-${fixtureSeq}`,
      displayName: 'Created replay model',
      tags: [],
      icon: null,
      groupId: null,
      kind: 'responses',
      enabled: true,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'medium', description: '中等' }],
      replayProviderContext: true,
      defaultWebSearch: false,
      defaultXSearch: false,
      sort: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.replayProviderContext).toBe(true)
    const [stored] = await dbClient.db
      .select({ replayProviderContext: schema.models.replayProviderContext })
      .from(schema.models)
      .where(eq(schema.models.id, result.model.id))
    expect(stored?.replayProviderContext).toBe(true)
  })

  it('removes Web/X Search capability and defaults from newly created Chat models', async () => {
    const fixture = await createFixture()
    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: `created-chat-${fixtureSeq}`,
      displayName: 'Created Chat model',
      tags: [],
      icon: null,
      groupId: null,
      kind: 'chat',
      enabled: true,
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        x_search: true,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'medium', description: '中等' }],
      replayProviderContext: false,
      defaultWebSearch: true,
      defaultXSearch: true,
      defaultParams: { temperature: 0.4, web_search: true, x_search: true },
      sort: 0,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toMatchObject({
      capabilities: { web_search: false, x_search: false },
      defaultWebSearch: false,
      defaultXSearch: false,
      defaultParams: { temperature: 0.4 },
    })
    const [stored] = await dbClient.db
      .select({
        capabilities: schema.models.capabilities,
        defaultWebSearch: schema.models.defaultWebSearch,
        defaultXSearch: schema.models.defaultXSearch,
        defaultParams: schema.models.defaultParams,
      })
      .from(schema.models)
      .where(eq(schema.models.id, result.model.id))
    expect(stored).toMatchObject({
      capabilities: { web_search: false, x_search: false },
      defaultWebSearch: false,
      defaultXSearch: false,
      defaultParams: { temperature: 0.4 },
    })
  })

  it('does not expose stale Web/X Search settings from existing Chat records', async () => {
    const fixture = await createFixture({ kind: 'chat' })
    await dbClient.db
      .update(schema.models)
      .set({
        capabilities: {
          vision: false,
          file_input: false,
          web_search: true,
          x_search: true,
          image_generation: false,
          reasoning: false,
        },
        defaultWebSearch: true,
        defaultXSearch: true,
        defaultParams: { temperature: 0.6, web_search: true, x_search: true },
      })
      .where(eq(schema.models.id, fixture.modelId))

    const publicModel = (await modelServices.listEnabledModels(fixture.userId)).find(
      (candidate) => candidate.id === fixture.modelId,
    )
    const adminModel = (await modelServices.listAdminModels()).find(
      (candidate) => candidate.id === fixture.modelId,
    )

    expect(publicModel).toMatchObject({
      capabilities: { web_search: false, x_search: false },
      defaultWebSearch: false,
      defaultXSearch: false,
      defaultParams: { temperature: 0.6 },
    })
    expect(adminModel).toMatchObject({
      capabilities: { web_search: false, x_search: false },
      defaultWebSearch: false,
      defaultXSearch: false,
      defaultParams: { temperature: 0.6 },
    })
  })

  it('rejects a model whose configured icon does not exist', async () => {
    const fixture = await createFixture()
    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: `missing-icon-${fixtureSeq}`,
      displayName: 'Missing icon model',
      tags: [],
      icon: { type: 'lobe', slug: 'definitely-not-installed' },
      groupId: null,
      kind: 'responses',
      enabled: true,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: false,
      },
      allowedEfforts: [],
      replayProviderContext: false,
      defaultWebSearch: false,
      defaultXSearch: false,
      sort: 0,
    })

    expect(result).toEqual({ ok: false, code: 'icon_missing' })
  })

  it('rejects a model engine that does not match its provider protocol', async () => {
    const fixture = await createFixture()
    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: 'claude-sonnet-5',
      displayName: 'Mismatched Claude',
      tags: [],
      icon: null,
      groupId: null,
      kind: 'anthropic',
      enabled: true,
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [],
      replayProviderContext: true,
      defaultWebSearch: false,
      defaultXSearch: false,
      sort: 0,
    })

    expect(result).toEqual({ ok: false, code: 'provider_protocol_mismatch' })
  })

  it('requires a visible max_output_tokens default for Anthropic models', async () => {
    const fixture = await createFixture()
    await dbClient.db
      .update(schema.providers)
      .set({ protocol: 'anthropic' })
      .where(eq(schema.providers.id, fixture.providerId))

    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: 'claude-sonnet-5',
      displayName: 'Claude without max tokens',
      tags: [],
      icon: null,
      groupId: null,
      kind: 'anthropic',
      enabled: true,
      capabilities: {
        vision: true,
        file_input: true,
        web_search: true,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [],
      replayProviderContext: true,
      defaultWebSearch: false,
      defaultXSearch: false,
      sort: 0,
    })

    expect(result).toEqual({ ok: false, code: 'anthropic_max_output_tokens_required' })
  })

  it('rejects an Anthropic manual thinking budget that exhausts the output limit', async () => {
    const fixture = await createFixture()
    await dbClient.db
      .update(schema.providers)
      .set({ protocol: 'anthropic' })
      .where(eq(schema.providers.id, fixture.providerId))

    const result = await modelServices.createModel({
      providerId: fixture.providerId,
      modelId: 'claude-haiku-4-5',
      displayName: 'Claude with invalid thinking budget',
      tags: [],
      icon: null,
      groupId: null,
      kind: 'anthropic',
      enabled: true,
      capabilities: {
        vision: true,
        file_input: true,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      defaultParams: { max_output_tokens: 4096 },
      hardParams: { thinking: { type: 'enabled', budget_tokens: 8192 } },
      allowedEfforts: [{ value: 'enabled', description: '开启' }],
      defaultEffort: 'enabled',
      replayProviderContext: true,
      defaultWebSearch: false,
      defaultXSearch: false,
      sort: 0,
    })

    expect(result).toEqual({ ok: false, code: 'anthropic_thinking_budget_conflict' })
  })

  it('does not import a catalog fetched from stale provider connection settings', async () => {
    const fixture = await createFixture()
    const [provider] = await dbClient.db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, fixture.providerId))
      .limit(1)
    if (!provider) throw new Error('provider fixture missing')

    let resolveFetch!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )
    const syncPromise = providerServices.syncProviderModels(provider)
    await dbClient.db
      .update(schema.providers)
      .set({ baseUrl: 'https://changed.example.test/v1' })
      .where(eq(schema.providers.id, provider.id))
    resolveFetch(
      new Response(JSON.stringify({ data: [{ id: 'catalog-model-from-stale-provider' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(syncPromise).rejects.toBeInstanceOf(
      providerServices.ProviderConnectionChangedError,
    )
    const inserted = await dbClient.db
      .select()
      .from(schema.models)
      .where(eq(schema.models.modelId, 'catalog-model-from-stale-provider'))
    expect(inserted).toEqual([])
  })

  it('normalizes legacy model tags and safely preserves custom colors', async () => {
    const fixture = await createFixture()
    await dbClient.db
      .update(schema.models)
      .set({
        tags: [
          ' 内测 ',
          { label: '推荐', color: '#ABCDEF' },
          { label: '安全回退', color: 'not-a-color' },
        ],
      })
      .where(eq(schema.models.id, fixture.modelId))

    const model = (await modelServices.listEnabledModels(fixture.userId)).find(
      (candidate) => candidate.id === fixture.modelId,
    )

    expect(model?.tags).toEqual([
      { label: '内测', color: null },
      { label: '推荐', color: '#abcdef' },
      { label: '安全回退', color: null },
    ])
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
