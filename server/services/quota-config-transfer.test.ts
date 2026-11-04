import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { QUOTA_CONFIG_FORMAT } from '@shared/schemas/quota-config-transfer'
import type { QuotaRule } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let transfer: typeof import('./quota-config-transfer')

const capabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  x_search: false,
  image_generation: false,
  reasoning: false,
  artifacts: false,
}

const monthly: QuotaRule = {
  id: 'rule-monthly',
  label: '每月',
  scope: { type: 'groups', groupIds: ['g-openai'], mode: 'each' },
  metric: 'cost',
  limit: { kind: 'amount', value: 30 },
  window: { type: 'calendar', period: 'month' },
  priority: 0,
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-quota-config-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-quota-config'
  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  transfer = await import('./quota-config-transfer')
  migration.runMigrations()

  await dbClient.db.insert(schema.modelGroups).values({ id: 'g-openai', name: 'OpenAI' })
  await dbClient.db.insert(schema.models).values([
    { id: 'm-luna', modelId: 'gpt-luna', displayName: 'Luna', capabilities, groupId: 'g-openai' },
    { id: 'm-sol-1', modelId: 'gpt-sol', displayName: 'Sol', capabilities },
    { id: 'm-sol-2', modelId: 'gpt-sol', displayName: 'Sol', capabilities },
  ])
  await dbClient.db.insert(schema.quotaPolicies).values([
    { id: 'p-default', name: '默认', rules: [monthly], isDefault: true, sort: 100 },
    { id: 'p-free', name: 'Free', rules: [], sort: 200 },
  ])
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const doc = (policies: unknown[]) => ({ format: QUOTA_CONFIG_FORMAT, version: 1, policies })
const storedPolicy = (id: string) =>
  dbClient.db.select().from(schema.quotaPolicies).where(eq(schema.quotaPolicies.id, id)).get()

describe('额度策略导入导出', () => {
  it('导出按名称引用目标；原样导回时全部无变化', async () => {
    const exported = await transfer.exportQuotaConfig()
    const defaultPolicy = exported.policies.find((policy) => policy.id === 'p-default')!
    expect(defaultPolicy.rules?.[0]?.scope).toEqual({
      type: 'groups',
      groups: ['OpenAI'],
      mode: 'each',
    })
    // 同名配置在参考信息里带上分组，引用时必须用 ID。
    expect(exported.models.filter((model) => model.name === 'Sol')).toHaveLength(2)

    const preview = await transfer.importQuotaConfig(exported, 'preview')
    expect(preview.valid).toBe(true)
    expect(preview.summary).toMatchObject({ unchanged: 2, update: 0, create: 0 })
  })

  it('按名称匹配已有策略并替换规则，名称引用解析成 ID', async () => {
    const preview = await transfer.importQuotaConfig(
      doc([
        {
          name: 'Free',
          rules: [
            {
              label: '免费模型',
              scope: { type: 'models', models: ['Luna'] },
              metric: 'chat_cost',
              limit: { kind: 'unlimited' },
              priority: 1,
            },
            {
              scope: { type: 'all' },
              metric: 'images',
              limit: { kind: 'amount', value: 10 },
              window: { type: 'calendar', period: 'day' },
            },
          ],
        },
      ]),
      'apply',
    )
    expect(preview.applied).toBe(true)
    expect(preview.items[0]).toMatchObject({ action: 'update', id: 'p-free', changes: ['规则'] })
    expect(preview.items[0]?.notes).toContain('按名称匹配到已有策略')
    const rules = storedPolicy('p-free')!.rules
    expect(rules[0]).toMatchObject({
      scope: { type: 'models', modelIds: ['m-luna'], mode: 'each' },
      window: { type: 'total' },
    })
    expect(rules[1]).toMatchObject({ metric: 'images', priority: 0 })
  })

  it('同名模型必须用 ID 引用，任一条出错整份不生效', async () => {
    const preview = await transfer.importQuotaConfig(
      doc([
        { name: '新策略', rules: [] },
        {
          id: 'p-default',
          rules: [{ ...monthly, scope: { type: 'models', models: ['Sol'] } }],
        },
      ]),
      'apply',
    )
    expect(preview.applied).toBe(false)
    expect(preview.items[0]?.action).toBe('create')
    expect(preview.items[1]?.errors).toEqual([
      'rules.0.scope.models.0：模型名称「Sol」不唯一，请改用 ID',
    ])
    expect(
      dbClient.db
        .select()
        .from(schema.quotaPolicies)
        .all()
        .some((policy) => policy.name === '新策略'),
    ).toBe(false)
  })

  it('新建并设为默认策略；不能让全站失去默认策略', async () => {
    const rejected = await transfer.importQuotaConfig(
      doc([{ id: 'p-default', isDefault: false }]),
      'preview',
    )
    expect(rejected.items[0]?.errors).toContain('必须保留一个默认策略：请把另一个策略设为默认')

    const applied = await transfer.importQuotaConfig(
      doc([{ name: 'VIP', isDefault: true, rules: [] }]),
      'apply',
    )
    expect(applied).toMatchObject({ applied: true, notices: ['设为默认策略：VIP'] })
    const vipId = applied.items[0]!.id!
    expect(storedPolicy(vipId)?.isDefault).toBe(true)
    expect(storedPolicy('p-default')?.isDefault).toBe(false)
  })
})
