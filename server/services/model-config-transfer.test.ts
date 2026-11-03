import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MODEL_CONFIG_FORMAT } from '@shared/schemas/model-config-transfer'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let transfer: typeof import('./model-config-transfer')

const capabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  x_search: false,
  image_generation: false,
  reasoning: false,
  artifacts: false,
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-model-config-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-model-config'
  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  transfer = await import('./model-config-transfer')
  migration.runMigrations()

  await dbClient.db.insert(schema.providers).values([
    { id: 'p-openai', name: 'OpenAI 主', baseUrl: 'https://a.test/v1', apiKey: 'secret-a' },
    {
      id: 'p-claude',
      name: 'Claude',
      baseUrl: 'https://c.test',
      apiKey: 'secret-c',
      protocol: 'anthropic',
    },
  ])
  await dbClient.db.insert(schema.modelGroups).values({ id: 'g-old', name: '常用' })
  await dbClient.db.insert(schema.models).values({
    id: 'm-existing',
    modelId: 'gpt-x',
    displayName: 'GPT X',
    capabilities,
    groupId: 'g-old',
    pricing: { input: 1, output: 2 },
  })
  await dbClient.db
    .insert(schema.modelRoutes)
    .values({ id: 'r-existing', modelId: 'm-existing', providerId: 'p-openai', sort: 100 })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const doc = (models: unknown[]) => ({ format: MODEL_CONFIG_FORMAT, version: 1, models })
const storedModel = (id: string) =>
  dbClient.db.select().from(schema.models).where(eq(schema.models.id, id)).get()

describe('模型配置导入导出', () => {
  it('导出可读的线路引用且不含密钥；原样导回时全部无变化', async () => {
    const exported = await transfer.exportModelConfig()
    expect(JSON.stringify(exported)).not.toContain('secret-')
    expect(exported.models).toEqual([
      expect.objectContaining({
        id: 'm-existing',
        group: '常用',
        routes: [expect.objectContaining({ id: 'r-existing', provider: 'OpenAI 主' })],
      }),
    ])
    const preview = await transfer.importModelConfig(exported, 'preview')
    expect(preview).toMatchObject({ valid: true, applied: false })
    expect(preview.summary).toEqual({ create: 0, update: 0, unchanged: 1, error: 0 })
  })

  it('只写出现的字段：预览不落库，应用后只改定价', async () => {
    const pricing = { currency: 'CNY' as const, input: 8, output: 16 }
    const preview = await transfer.importModelConfig(
      doc([{ id: 'm-existing', pricing }]),
      'preview',
    )
    expect(preview.items[0]).toMatchObject({ action: 'update', changes: ['用户计价'] })
    expect(storedModel('m-existing')?.pricing).toEqual({ input: 1, output: 2 })

    const applied = await transfer.importModelConfig(doc([{ id: 'm-existing', pricing }]), 'apply')
    expect(applied.applied).toBe(true)
    expect(storedModel('m-existing')).toMatchObject({
      pricing,
      displayName: 'GPT X',
      groupId: 'g-old',
    })
  })

  it('新建模型按供应商协议推断默认配置，并自动创建分组', async () => {
    const applied = await transfer.importModelConfig(
      doc([
        {
          modelId: 'claude-sonnet-5',
          group: 'Claude 系列',
          routes: [
            { provider: 'Claude', priority: 10 },
            { provider: 'p-claude', upstreamModelId: 'claude-sonnet-5-backup' },
          ],
          pricing: { input: 3, output: 15 },
        },
      ]),
      'apply',
    )
    expect(applied).toMatchObject({ applied: true, groupsToCreate: ['Claude 系列'] })
    const id = applied.items[0]!.id!
    const model = storedModel(id)!
    expect(model).toMatchObject({ kind: 'anthropic', displayName: 'claude-sonnet-5' })
    expect(model.defaultParams?.max_output_tokens).toBeGreaterThan(0)
    const routes = dbClient.db
      .select()
      .from(schema.modelRoutes)
      .where(eq(schema.modelRoutes.modelId, id))
      .orderBy(schema.modelRoutes.sort)
      .all()
    expect(routes.map((route) => [route.priority, route.upstreamModelId])).toEqual([
      [10, null],
      [0, 'claude-sonnet-5-backup'],
    ])
  })

  it('任一条出错时整份不生效，并逐条报告问题', async () => {
    const groupsBefore = dbClient.db.select().from(schema.modelGroups).all().length
    const result = await transfer.importModelConfig(
      doc([
        { id: 'm-existing', displayName: '不应生效' },
        { modelId: 'new-model', group: '不应创建', routes: [{ provider: '不存在的供应商' }] },
        { modelId: 'typo-model', routes: [{ provider: 'OpenAI 主' }], price: 1 },
      ]),
      'apply',
    )
    expect(result.applied).toBe(false)
    expect(result.items.map((item) => item.action)).toEqual(['update', 'error', 'error'])
    expect(result.items[1]!.errors).toEqual(['routes.0.provider：找不到供应商「不存在的供应商」'])
    expect(result.items[2]).toMatchObject({
      label: 'typo-model',
      errors: ['不支持的字段：price'],
    })

    const duplicated = await transfer.importModelConfig(
      doc([
        { id: 'm-existing', displayName: 'A' },
        { id: 'm-existing', displayName: 'B' },
      ]),
      'preview',
    )
    expect(duplicated.items.map((item) => item.errors)).toEqual([
      ['同一模型在文档中出现了多次'],
      ['同一模型在文档中出现了多次'],
    ])
    expect(storedModel('m-existing')?.displayName).toBe('GPT X')
    expect(dbClient.db.select().from(schema.modelGroups).all()).toHaveLength(groupsBefore)
  })

  it('拒绝与供应商协议不兼容的线路与错误的文档格式', async () => {
    const mismatch = await transfer.importModelConfig(
      doc([{ id: 'm-existing', routes: [{ provider: 'Claude' }] }]),
      'preview',
    )
    expect(mismatch.items[0]!.errors).toEqual(['模型类型与线路供应商的协议不匹配'])
    const invalid = await transfer.importModelConfig({ format: 'other', models: [] }, 'preview')
    expect(invalid.valid).toBe(false)
    expect(invalid.documentErrors.length).toBeGreaterThan(0)
  })
})
