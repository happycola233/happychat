import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let cookie: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let lobeIconAssetVersion: string
let fixtureSequence = 0

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-model-icon-routes-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-model-icon-routes'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()

  const adminId = 'model-icon-route-admin'
  await dbClient.db.insert(schema.users).values({
    id: adminId,
    username: adminId,
    passwordHash: 'hash',
    role: 'admin',
  })
  const { createSession } = await import('../auth/session')
  const loginApp = new Hono()
  loginApp.get('/', async (c) => {
    await createSession(c, adminId)
    return c.body(null, 204)
  })
  const loginResponse = await loginApp.request('/')
  cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? ''

  const [{ adminRoutes }, { modelIconRoutes }, lobeIcons] = await Promise.all([
    import('./admin'),
    import('./model-icons'),
    import('../services/lobe-icons'),
  ])
  lobeIconAssetVersion = lobeIcons.lobeIconAssetVersion
  app = new Hono<AppEnv>()
  app.route('/api/admin', adminRoutes)
  app.route('/api/model-icons', modelIconRoutes)
  app.onError((error, c) => c.json({ error: { message: error.message } }, 500))
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

function authenticatedRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cookie', cookie)
  return app.request(path, { ...init, headers })
}

async function createModelFixture() {
  const sequence = fixtureSequence++
  const providerId = `model-icon-provider-${sequence}`
  const modelId = `model-icon-model-${sequence}`
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${sequence}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: `upstream-${sequence}`,
    displayName: `Model ${sequence}`,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
  })
  return modelId
}

describe('model icon routes', () => {
  it('renders currentColor for the requested theme and versions immutable caching', async () => {
    const catalog = await authenticatedRequest('/api/model-icons/catalog')
    expect(catalog.status).toBe(200)
    expect(catalog.headers.get('cache-control')).toBe('no-cache')
    await expect(catalog.json()).resolves.toMatchObject({ version: lobeIconAssetVersion })

    const dark = await authenticatedRequest(
      `/api/model-icons/lobe/aws-color?theme=dark&v=${lobeIconAssetVersion}`,
    )
    expect(dark.status).toBe(200)
    expect(dark.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(dark.headers.get('etag')).toContain(`-${lobeIconAssetVersion}-dark-aws-color`)
    const darkSvg = await dark.text()
    expect(darkSvg).toContain('#f5f5f5')
    expect(darkSvg).toContain('#F90')
    expect(darkSvg).not.toContain('currentColor')

    const unversioned = await authenticatedRequest('/api/model-icons/lobe/openai?theme=light')
    expect(unversioned.status).toBe(200)
    expect(unversioned.headers.get('cache-control')).toBe('no-cache')
    expect(unversioned.headers.get('etag')).toContain(`-${lobeIconAssetVersion}-light-openai`)
    expect(await unversioned.text()).toContain('#171717')

    const staleVersion = await authenticatedRequest(
      '/api/model-icons/lobe/openai?theme=light&v=stale',
    )
    expect(staleVersion.status).toBe(200)
    expect(staleVersion.headers.get('cache-control')).toBe('no-cache')
  })

  it('rejects missing icon and group references in model PATCH without changing the model', async () => {
    const modelId = await createModelFixture()
    const missingIcon = await authenticatedRequest(`/api/admin/models/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: { type: 'lobe', slug: 'definitely-not-installed' } }),
    })
    expect(missingIcon.status).toBe(400)
    await expect(missingIcon.json()).resolves.toMatchObject({ error: { code: 'icon_missing' } })

    const missingGroup = await authenticatedRequest(`/api/admin/models/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'missing-group' }),
    })
    expect(missingGroup.status).toBe(400)
    await expect(missingGroup.json()).resolves.toMatchObject({ error: { code: 'group_missing' } })

    const model = dbClient.db
      .select({ icon: schema.models.icon, groupId: schema.models.groupId })
      .from(schema.models)
      .where(eq(schema.models.id, modelId))
      .get()
    expect(model).toEqual({ icon: null, groupId: null })
  })

  it('通过管理接口创建模型副本并更换已有模型的供应商', async () => {
    const modelId = await createModelFixture()
    const targetProviderId = `model-provider-switch-${fixtureSequence++}`
    await dbClient.db.insert(schema.providers).values({
      id: targetProviderId,
      name: 'Target Provider',
      baseUrl: 'https://target.example.test/v1',
      apiKey: 'test-key',
      protocol: 'openai',
    })

    const duplicate = await authenticatedRequest(`/api/admin/models/${modelId}/duplicate`, {
      method: 'POST',
    })
    expect(duplicate.status).toBe(200)
    const duplicated = (await duplicate.json()) as {
      model: { id: string; displayName: string; providerId: string }
    }
    expect(duplicated.model).toMatchObject({
      displayName: expect.stringMatching(/ 副本$/),
    })
    expect(duplicated.model.id).not.toBe(modelId)

    const updateProvider = await authenticatedRequest(`/api/admin/models/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: targetProviderId }),
    })
    expect(updateProvider.status).toBe(200)
    expect(
      dbClient.db
        .select({ providerId: schema.models.providerId })
        .from(schema.models)
        .where(eq(schema.models.id, modelId))
        .get(),
    ).toEqual({ providerId: targetProviderId })
  })

  it('preserves dots in an explicitly supplied custom icon name', async () => {
    const form = new FormData()
    form.append(
      'file',
      new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'acme.v2.svg', {
        type: 'image/svg+xml',
      }),
    )
    form.append('name', 'acme.v2')
    const response = await authenticatedRequest('/api/admin/model-icons/custom', {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { icon: { id: string } }
    const icon = dbClient.db
      .select({ name: schema.modelIcons.name })
      .from(schema.modelIcons)
      .where(eq(schema.modelIcons.id, payload.icon.id))
      .get()
    expect(icon?.name).toBe('acme.v2')
  })

  it('rolls back SQL deletion when strict disk deletion fails', async () => {
    const iconId = '12345678-deletion-rollback'
    const groupId = 'model-icon-deletion-group'
    await dbClient.db.insert(schema.modelIcons).values({
      id: iconId,
      name: '无法删除的图标',
      storagePath: join(temporaryDirectory, '..', 'outside.svg'),
      mime: 'image/svg+xml',
    })
    await dbClient.db.insert(schema.modelGroups).values({
      id: groupId,
      name: '引用图标的分组',
      icon: { type: 'custom', id: iconId },
    })

    const response = await authenticatedRequest(`/api/admin/model-icons/custom/${iconId}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(500)
    expect(
      dbClient.db
        .select({ id: schema.modelIcons.id })
        .from(schema.modelIcons)
        .where(eq(schema.modelIcons.id, iconId))
        .get(),
    ).toEqual({ id: iconId })
    expect(
      dbClient.db
        .select({ icon: schema.modelGroups.icon })
        .from(schema.modelGroups)
        .where(eq(schema.modelGroups.id, groupId))
        .get()?.icon,
    ).toEqual({ type: 'custom', id: iconId })
  })
})
