import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyQuotaDTO, QuotaPolicyDTO, UsageStatsDTO } from '@shared/types/api'
import type { ModelPricing } from '@shared/types/domain'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let adminCookie: string
let userCookie: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let appConfig: typeof import('./../services/appConfig')
let adminId: string
let userId: string
let modelId: string

const PRICING: ModelPricing = { input: 1_000_000 }

async function cookieFor(userIdToLogin: string): Promise<string> {
  const { createSession } = await import('../auth/session')
  const loginApp = new Hono()
  loginApp.get('/', async (c) => {
    await createSession(c, userIdToLogin)
    return c.body(null, 204)
  })
  const response = await loginApp.request('/')
  return response.headers.get('set-cookie')?.split(';')[0] ?? ''
}

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-quota-routes-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-quota-routes'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  appConfig = await import('../services/appConfig')
  migration.runMigrations()

  adminId = 'quota-route-admin'
  userId = 'quota-route-user'
  await dbClient.db.insert(schema.users).values([
    { id: adminId, username: adminId, passwordHash: 'hash', role: 'admin' },
    { id: userId, username: userId, passwordHash: 'hash', role: 'user' },
  ])
  await dbClient.db.insert(schema.providers).values({
    id: 'quota-route-provider',
    name: 'Provider',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    protocol: 'openai',
  })
  modelId = 'quota-route-model'
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId: 'quota-route-provider',
    modelId: 'upstream',
    displayName: '测试模型',
    pricing: PRICING,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
  })

  adminCookie = await cookieFor(adminId)
  userCookie = await cookieFor(userId)

  const [{ adminRoutes }, { quotaRoutes }] = await Promise.all([
    import('./admin'),
    import('./quota'),
  ])
  app = new Hono<AppEnv>()
  app.route('/api/admin', adminRoutes)
  app.route('/api/quota', quotaRoutes)
  app.onError((error, c) => c.json({ error: { message: error.message } }, 500))
})

beforeEach(async () => {
  dbClient.sqlite.exec('DELETE FROM quota_adjustments')
  dbClient.sqlite.exec('DELETE FROM user_quotas')
  dbClient.sqlite.exec('DELETE FROM quota_policies')
  dbClient.sqlite.exec('DELETE FROM usage_logs')
  dbClient.sqlite.exec('DELETE FROM app_settings')
  await appConfig.updateAppConfig({ quotaEnabled: true })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cookie', cookie)
  if (init.body) headers.set('Content-Type', 'application/json')
  return app.request(path, { ...init, headers })
}

async function createPolicy(rules: unknown[], name = '默认'): Promise<QuotaPolicyDTO> {
  const response = await request('/api/admin/quota/policies', adminCookie, {
    method: 'POST',
    body: JSON.stringify({ name, rules, isDefault: true }),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { policy: QuotaPolicyDTO }).policy
}

const dailyRequests = {
  id: 'r-req',
  scope: { type: 'all' },
  metric: 'requests',
  limit: { kind: 'amount', value: 1 },
  window: { type: 'calendar', period: 'day' },
}

async function logUsage() {
  await dbClient.db.insert(schema.usageLogs).values({
    userId,
    modelId,
    pricingSnapshot: PRICING,
    inputTokens: 1,
    totalTokens: 1,
    success: true,
  })
}

describe('GET /api/quota/me', () => {
  it('全局关闭时只报告 enabled:false，不泄露任何额度数字', async () => {
    await createPolicy([dailyRequests])
    await logUsage()
    await appConfig.updateAppConfig({ quotaEnabled: false })

    const response = await request('/api/quota/me', userCookie)
    const { quota } = (await response.json()) as { quota: MyQuotaDTO }
    expect(quota.enabled).toBe(false)
    expect(quota.rules).toEqual([])
    expect(quota.blockedModelIds).toEqual([])
  })

  it('开启后返回逐规则用量与耗尽模型', async () => {
    await createPolicy([dailyRequests])
    await logUsage()

    const response = await request('/api/quota/me', userCookie)
    const { quota } = (await response.json()) as { quota: MyQuotaDTO }
    expect(quota.enabled).toBe(true)
    expect(quota.rules).toHaveLength(1)
    expect(quota.rules[0]?.used).toBe(1)
    expect(quota.rules[0]?.blocked).toBe(true)
    expect(quota.blockedModelIds).toEqual([modelId])
    expect(quota.warnThreshold).toBeCloseTo(0.8)
  })

  it('未登录被拒绝', async () => {
    expect((await app.request('/api/quota/me')).status).toBe(401)
  })
})

describe('GET /api/quota/usage', () => {
  it('返回热力图与总量，并校验查询参数', async () => {
    await logUsage()
    const response = await request(
      '/api/quota/usage?timezone=Asia%2FShanghai&tzOffsetMinutes=480&days=30',
      userCookie,
    )
    const { stats } = (await response.json()) as { stats: UsageStatsDTO }
    expect(stats.rangeDays).toBe(30)
    expect(stats.heatmap).toHaveLength(30)
    expect(stats.totals.requests).toBe(1)

    expect((await request('/api/quota/usage?days=3', userCookie)).status).toBe(400)
    expect((await request('/api/quota/usage?tzOffsetMinutes=9999', userCookie)).status).toBe(400)
    expect((await request('/api/quota/usage?timezone=Not%2FAZone', userCookie)).status).toBe(400)
  })

  it('只能看到自己的用量', async () => {
    await logUsage()
    const response = await request('/api/quota/usage', adminCookie)
    const { stats } = (await response.json()) as { stats: UsageStatsDTO }
    expect(stats.totals.requests).toBe(0)
  })
})

describe('管理端限额接口', () => {
  it('普通用户无法访问', async () => {
    expect((await request('/api/admin/quota/policies', userCookie)).status).toBe(403)
    expect((await request(`/api/admin/quota/users/${userId}`, userCookie)).status).toBe(403)
  })

  it('策略 CRUD 与默认策略切换', async () => {
    const created = await createPolicy([dailyRequests], '测试账号')
    expect(created.isDefault).toBe(true)

    const patched = await request(`/api/admin/quota/policies/${created.id}`, adminCookie, {
      method: 'PATCH',
      body: JSON.stringify({ name: '测试账号 2' }),
    })
    expect(patched.status).toBe(200)

    const duplicated = await request(
      `/api/admin/quota/policies/${created.id}/duplicate`,
      adminCookie,
      { method: 'POST' },
    )
    expect(duplicated.status).toBe(200)
    const copy = ((await duplicated.json()) as { policy: QuotaPolicyDTO }).policy
    expect(copy.rules[0]?.id).not.toBe('r-req')

    // 还有其他策略时不允许删除默认策略
    const deleteDefault = await request(`/api/admin/quota/policies/${created.id}`, adminCookie, {
      method: 'DELETE',
    })
    expect(deleteDefault.status).toBe(400)

    const deleteCopy = await request(`/api/admin/quota/policies/${copy.id}`, adminCookie, {
      method: 'DELETE',
    })
    expect(deleteCopy.status).toBe(200)
    expect(
      (await request('/api/admin/quota/policies/ghost/default', adminCookie, { method: 'POST' }))
        .status,
    ).toBe(404)
  })

  it('临时额度让已耗尽的用户重新可用，撤销后立即恢复限制', async () => {
    const policy = await createPolicy([dailyRequests])
    await request(`/api/admin/quota/users/${userId}`, adminCookie, {
      method: 'PUT',
      body: JSON.stringify({ policyId: policy.id, overrides: {}, enforcementPaused: false }),
    })
    await logUsage()

    const before = (await (await request('/api/quota/me', userCookie)).json()) as {
      quota: MyQuotaDTO
    }
    expect(before.quota.blockedModelIds).toEqual([modelId])

    const grantResponse = await request(`/api/admin/quota/users/${userId}/grants`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ ruleId: 'r-req', amount: 5, note: '临时赠送' }),
    })
    expect(grantResponse.status).toBe(200)
    const grantId = ((await grantResponse.json()) as { grant: { id: string } }).grant.id

    const granted = (await (await request('/api/quota/me', userCookie)).json()) as {
      quota: MyQuotaDTO
    }
    expect(granted.quota.blockedModelIds).toEqual([])
    expect(granted.quota.rules[0]?.granted).toBe(5)

    expect(
      (await request(`/api/admin/quota/grants/${grantId}`, adminCookie, { method: 'DELETE' }))
        .status,
    ).toBe(200)
    const revoked = (await (await request('/api/quota/me', userCookie)).json()) as {
      quota: MyQuotaDTO
    }
    expect(revoked.quota.blockedModelIds).toEqual([modelId])
  })

  it('手动重置当前周期后用量归零，用量日志仍在', async () => {
    const policy = await createPolicy([dailyRequests])
    await request(`/api/admin/quota/users/${userId}`, adminCookie, {
      method: 'PUT',
      body: JSON.stringify({ policyId: policy.id, overrides: {}, enforcementPaused: false }),
    })
    await logUsage()

    const reset = await request(`/api/admin/quota/users/${userId}/reset`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(reset.status).toBe(200)

    const after = (await (await request('/api/quota/me', userCookie)).json()) as {
      quota: MyQuotaDTO
    }
    expect(after.quota.rules[0]?.used).toBe(0)

    const events = await request('/api/admin/usage-events?userId=' + userId, adminCookie)
    const payload = (await events.json()) as { total: number }
    expect(payload.total).toBe(1)
  })

  it('批量指派与预览', async () => {
    const policy = await createPolicy([dailyRequests])
    const batch = await request('/api/admin/quota/users/batch-assign', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ userIds: [userId], policyId: policy.id }),
    })
    expect(batch.status).toBe(200)

    const missing = await request('/api/admin/quota/users/batch-assign', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ userIds: ['ghost'], policyId: policy.id }),
    })
    expect(missing.status).toBe(400)

    await logUsage()
    const preview = await request('/api/admin/quota/preview', adminCookie, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        policyId: policy.id,
        overrides: { rules: { 'r-req': { limit: { kind: 'amount', value: 10 } } } },
        enforcementPaused: false,
      }),
    })
    const { preview: result } = (await preview.json()) as {
      preview: { rules: { effectiveLimit: number | null }[]; blockedRules: unknown[] }
    }
    expect(result.rules[0]?.effectiveLimit).toBe(10)
    expect(result.blockedRules).toHaveLength(0)
  })

  it('用户明细返回生效规则与分模型构成', async () => {
    const policy = await createPolicy([dailyRequests])
    await request(`/api/admin/quota/users/${userId}`, adminCookie, {
      method: 'PUT',
      body: JSON.stringify({ policyId: policy.id, overrides: {}, enforcementPaused: true }),
    })
    await logUsage()

    const response = await request(`/api/admin/quota/users/${userId}`, adminCookie)
    const { detail } = (await response.json()) as {
      detail: {
        enforcementPaused: boolean
        rules: { used: number }[]
        byModel: { requests: number }[]
      }
    }
    expect(detail.enforcementPaused).toBe(true)
    expect(detail.rules[0]?.used).toBe(1)
    expect(detail.byModel[0]?.requests).toBe(1)
    expect((await request('/api/admin/quota/users/ghost', adminCookie)).status).toBe(404)
  })
})
