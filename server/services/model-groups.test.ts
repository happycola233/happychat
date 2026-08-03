import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let groupServices: typeof import('./model-groups')
let modelServices: typeof import('./models')
let fixtureSeq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-model-groups-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-model-groups'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  groupServices = await import('./model-groups')
  modelServices = await import('./models')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

/** 建一个用户 + 供应商 + N 个模型；每次调用用递增序号保证 id 唯一，不做全表清理。 */
async function createFixture(modelCount = 1) {
  const n = fixtureSeq++
  const userId = `group-user-${n}`
  const providerId = `group-provider-${n}`

  await dbClient.db
    .insert(schema.users)
    .values({ id: userId, username: `group-user-${n}`, passwordHash: 'hash', role: 'user' })
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    protocol: 'openai',
  })

  const modelIds: string[] = []
  for (let i = 0; i < modelCount; i++) {
    const id = `group-model-${n}-${i}`
    modelIds.push(id)
    await dbClient.db.insert(schema.models).values({
      id,
      providerId,
      modelId: `upstream-${n}-${i}`,
      displayName: `Model ${n}-${i}`,
      sort: (i + 1) * 100,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: false,
      },
    })
  }
  return { userId, providerId, modelIds }
}

async function readModel(id: string) {
  const [row] = await dbClient.db.select().from(schema.models).where(eq(schema.models.id, id))
  return row!
}

async function createGroup(input: Parameters<typeof groupServices.createModelGroup>[0]) {
  const result = await groupServices.createModelGroup(input)
  if (!result.ok) throw new Error(`创建测试分组失败：${result.code}`)
  return result.group
}

describe('model group CRUD', () => {
  it('creates groups at the end of the order with a sparse sort step', async () => {
    const first = await createGroup({ name: '分组甲' })
    const second = await createGroup({ name: '分组乙' })
    expect(second.sort).toBeGreaterThan(first.sort)
    expect(second.sort - first.sort).toBe(100)
    expect(second.modelCount).toBe(0)
  })

  it('normalizes a corrupted icon column instead of leaking it to the DTO', async () => {
    const group = await createGroup({ name: '脏图标分组' })
    await dbClient.db
      .update(schema.modelGroups)
      // 历史脏数据 / 手工改库：图标会被拼进 URL，DTO 边界必须兜住。
      .set({ icon: { type: 'lobe', slug: '../../etc/passwd' } as never })
      .where(eq(schema.modelGroups.id, group.id))

    const listed = (await groupServices.listAdminModelGroups()).find((g) => g.id === group.id)
    expect(listed?.icon).toBeNull()
  })

  it('updates only the provided fields and clears with null', async () => {
    const group = await createGroup({
      name: '原名',
      icon: { type: 'emoji', char: '🚀' },
      color: '#aabbcc',
    })
    const renamed = await groupServices.updateModelGroup(group.id, { name: '新名' })
    expect(renamed).toMatchObject({ ok: true, group: { name: '新名', color: '#aabbcc' } })
    if (!renamed.ok) return
    expect(renamed.group.icon).toEqual({ type: 'emoji', char: '🚀' })

    const cleared = await groupServices.updateModelGroup(group.id, { icon: null, color: null })
    expect(cleared).toMatchObject({
      ok: true,
      group: { name: '新名', icon: null, color: null },
    })
  })

  it('returns null / false for unknown groups', async () => {
    expect(await groupServices.updateModelGroup('nope', { name: 'x' })).toEqual({
      ok: false,
      code: 'group_missing',
    })
    expect(await groupServices.deleteModelGroup('nope')).toBe(false)
  })

  it('rejects lobe and custom icon references that do not exist', async () => {
    await expect(
      groupServices.createModelGroup({
        name: '不存在的内置图标',
        icon: { type: 'lobe', slug: 'definitely-not-installed' },
      }),
    ).resolves.toEqual({ ok: false, code: 'icon_missing' })
    await expect(
      groupServices.createModelGroup({
        name: '不存在的自定义图标',
        icon: { type: 'custom', id: 'deadbeef' },
      }),
    ).resolves.toEqual({ ok: false, code: 'icon_missing' })
  })

  it('accepts a custom icon that exists in the icon library', async () => {
    const iconId = `12345678-${fixtureSeq++}`
    await dbClient.db.insert(schema.modelIcons).values({
      id: iconId,
      name: '测试图标',
      storagePath: 'data/uploads/model-icons/test.svg',
      mime: 'image/svg+xml',
    })

    const result = await groupServices.createModelGroup({
      name: '有效自定义图标',
      icon: { type: 'custom', id: iconId },
    })
    expect(result).toMatchObject({
      ok: true,
      group: { icon: { type: 'custom', id: iconId } },
    })
  })

  it('keeps the previous icon when an update references a missing icon', async () => {
    const group = await createGroup({
      name: '图标引用校验',
      icon: { type: 'lobe', slug: 'openai' },
    })
    const result = await groupServices.updateModelGroup(group.id, {
      icon: { type: 'custom', id: 'deadbeef' },
    })

    expect(result).toEqual({ ok: false, code: 'icon_missing' })
    expect((await groupServices.getModelGroup(group.id))?.icon).toEqual({
      type: 'lobe',
      slug: 'openai',
    })
  })

  it('counts models per group', async () => {
    const { modelIds } = await createFixture(3)
    const group = await createGroup({ name: '计数分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds.slice(0, 2))

    const listed = (await groupServices.listAdminModelGroups()).find((g) => g.id === group.id)
    expect(listed?.modelCount).toBe(2)
  })
})

describe('deleteModelGroup', () => {
  it('moves member models back to ungrouped without deleting them', async () => {
    const { modelIds } = await createFixture(2)
    const group = await createGroup({ name: '待删除' })
    await groupServices.assignModelsToGroup(group.id, modelIds)

    expect(await groupServices.deleteModelGroup(group.id)).toBe(true)
    for (const id of modelIds) {
      const row = await readModel(id)
      expect(row).toBeDefined()
      expect(row.groupId).toBeNull()
    }
  })

  it('preserves each model updatedAt so a group change does not look like a config edit', async () => {
    const { modelIds } = await createFixture(1)
    const group = await createGroup({ name: '时间戳分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds)
    const before = (await readModel(modelIds[0]!)).updatedAt

    await new Promise((resolve) => setTimeout(resolve, 5))
    await groupServices.deleteModelGroup(group.id)

    expect((await readModel(modelIds[0]!)).updatedAt.getTime()).toBe(before.getTime())
  })
})

describe('reorderModelGroups', () => {
  it('rewrites sort with a sparse step for an exhaustive id list', async () => {
    const a = await createGroup({ name: '排序A' })
    const b = await createGroup({ name: '排序B' })
    const all = (await groupServices.listAdminModelGroups()).map((g) => g.id)
    const reordered = [b.id, a.id, ...all.filter((id) => id !== a.id && id !== b.id)]

    expect(await groupServices.reorderModelGroups(reordered)).toEqual({ ok: true })
    const after = await groupServices.listAdminModelGroups()
    expect(after[0]!.id).toBe(b.id)
    expect(after[1]!.id).toBe(a.id)
    expect(after[0]!.sort).toBe(100)
    expect(after[1]!.sort).toBe(200)
  })

  it('rejects a non-exhaustive list rather than silently reordering a subset', async () => {
    const group = await createGroup({ name: '穷尽性校验' })
    const result = await groupServices.reorderModelGroups([group.id])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid_order')
      expect(result.invalidIds.length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown ids', async () => {
    const all = (await groupServices.listAdminModelGroups()).map((g) => g.id)
    const result = await groupServices.reorderModelGroups([...all, 'ghost-group'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.invalidIds).toContain('ghost-group')
  })
})

describe('assignModelsToGroup', () => {
  it('moves every model in one atomic batch', async () => {
    const { modelIds } = await createFixture(3)
    const group = await createGroup({ name: '批量指派' })
    const result = await groupServices.assignModelsToGroup(group.id, modelIds)

    expect(result).toEqual({ ok: true, moved: 3 })
    for (const id of modelIds) expect((await readModel(id)).groupId).toBe(group.id)
  })

  it('moves models out of any group when groupId is null', async () => {
    const { modelIds } = await createFixture(1)
    const group = await createGroup({ name: '移出分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds)
    await groupServices.assignModelsToGroup(null, modelIds)
    expect((await readModel(modelIds[0]!)).groupId).toBeNull()
  })

  it('fails the whole batch when any model id is unknown', async () => {
    const { modelIds } = await createFixture(1)
    const group = await createGroup({ name: '部分失败' })
    const result = await groupServices.assignModelsToGroup(group.id, [...modelIds, 'ghost-model'])

    expect(result.ok).toBe(false)
    if (!result.ok && result.code === 'unknown_models') {
      expect(result.invalidIds).toEqual(['ghost-model'])
    }
    // 关键：不能出现「移了一半」的中间态。
    expect((await readModel(modelIds[0]!)).groupId).toBeNull()
  })

  it('rejects an unknown target group', async () => {
    const { modelIds } = await createFixture(1)
    const result = await groupServices.assignModelsToGroup('ghost-group', modelIds)
    expect(result).toEqual({ ok: false, code: 'group_missing' })
  })
})

describe('applyModelIcons', () => {
  it('writes icons in bulk and preserves updatedAt', async () => {
    const { modelIds } = await createFixture(2)
    const before = (await readModel(modelIds[0]!)).updatedAt
    await new Promise((resolve) => setTimeout(resolve, 5))

    const result = await groupServices.applyModelIcons([
      { id: modelIds[0]!, icon: { type: 'lobe', slug: 'openai' } },
      { id: modelIds[1]!, icon: null },
    ])

    expect(result).toEqual({ ok: true, updated: 2 })
    expect((await readModel(modelIds[0]!)).icon).toEqual({ type: 'lobe', slug: 'openai' })
    expect((await readModel(modelIds[1]!)).icon).toBeNull()
    expect((await readModel(modelIds[0]!)).updatedAt.getTime()).toBe(before.getTime())
  })

  it('fails the whole batch on unknown models', async () => {
    const { modelIds } = await createFixture(1)
    const result = await groupServices.applyModelIcons([
      { id: modelIds[0]!, icon: { type: 'lobe', slug: 'grok' } },
      { id: 'ghost-model', icon: null },
    ])
    expect(result.ok).toBe(false)
    expect((await readModel(modelIds[0]!)).icon).toBeNull()
  })

  it('fails the whole batch before writing when any icon reference is missing', async () => {
    const { modelIds } = await createFixture(2)
    const result = await groupServices.applyModelIcons([
      { id: modelIds[0]!, icon: { type: 'lobe', slug: 'openai' } },
      { id: modelIds[1]!, icon: { type: 'custom', id: 'deadbeef' } },
    ])

    expect(result).toEqual({ ok: false, code: 'icon_missing' })
    expect((await readModel(modelIds[0]!)).icon).toBeNull()
    expect((await readModel(modelIds[1]!)).icon).toBeNull()
  })
})

describe('listVisibleModelGroups', () => {
  it('hides groups whose models are all invisible to the user', async () => {
    const { userId, modelIds } = await createFixture(1)
    const group = await createGroup({ name: '受限分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds)
    // 模型限定给别人：分组不能因此暴露给当前用户（否则可从分组反推模型存在）。
    await dbClient.db
      .update(schema.models)
      .set({ accessMode: 'selected' })
      .where(eq(schema.models.id, modelIds[0]!))

    const visible = await groupServices.listVisibleModelGroups(userId)
    expect(visible.map((g) => g.id)).not.toContain(group.id)
  })

  it('hides groups whose models are globally disabled', async () => {
    const { userId, modelIds } = await createFixture(1)
    const group = await createGroup({ name: '停用分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds)
    await dbClient.db
      .update(schema.models)
      .set({ enabled: false })
      .where(eq(schema.models.id, modelIds[0]!))

    const visible = await groupServices.listVisibleModelGroups(userId)
    expect(visible.map((g) => g.id)).not.toContain(group.id)
  })

  it('hides empty groups but shows groups with at least one visible model', async () => {
    const { userId, modelIds } = await createFixture(1)
    const empty = await createGroup({ name: '空分组' })
    const filled = await createGroup({ name: '有模型的分组' })
    await groupServices.assignModelsToGroup(filled.id, modelIds)

    const visible = await groupServices.listVisibleModelGroups(userId)
    expect(visible.map((g) => g.id)).toContain(filled.id)
    expect(visible.map((g) => g.id)).not.toContain(empty.id)
  })

  it('agrees with listEnabledModels about which groups can appear', async () => {
    const { userId, modelIds } = await createFixture(2)
    const group = await createGroup({ name: '一致性分组' })
    await groupServices.assignModelsToGroup(group.id, modelIds)

    const models = await modelServices.listEnabledModels(userId)
    const visible = await groupServices.listVisibleModelGroups(userId)
    const referenced = new Set(models.map((m) => m.groupId).filter(Boolean))
    // 用户端选择器按 groupId 归组：可见分组集合必须覆盖模型引用到的每一个分组。
    for (const groupId of referenced) {
      expect(visible.map((g) => g.id)).toContain(groupId)
    }
  })

  it('returns groups in sort order', async () => {
    const { userId, modelIds } = await createFixture(2)
    const a = await createGroup({ name: '顺序甲' })
    const b = await createGroup({ name: '顺序乙' })
    await groupServices.assignModelsToGroup(a.id, [modelIds[0]!])
    await groupServices.assignModelsToGroup(b.id, [modelIds[1]!])

    const visible = await groupServices.listVisibleModelGroups(userId)
    const sorts = visible.map((g) => g.sort)
    expect([...sorts].sort((x, y) => x - y)).toEqual(sorts)
  })
})

describe('model DTO icon/group passthrough', () => {
  it('exposes icon and groupId to users and tolerates legacy null columns', async () => {
    const { userId, modelIds } = await createFixture(2)
    const group = await createGroup({ name: 'DTO 分组' })
    await groupServices.assignModelsToGroup(group.id, [modelIds[0]!])
    await groupServices.applyModelIcons([
      { id: modelIds[0]!, icon: { type: 'emoji', char: '🚀' } },
    ])

    const models = await modelServices.listEnabledModels(userId)
    const configured = models.find((m) => m.id === modelIds[0]!)
    const legacy = models.find((m) => m.id === modelIds[1]!)

    expect(configured).toMatchObject({ groupId: group.id, icon: { type: 'emoji', char: '🚀' } })
    // 迁移前建的老记录两列都是 null，读取不能炸。
    expect(legacy).toMatchObject({ groupId: null, icon: null })
  })

  it('drops a corrupted model icon at the DTO boundary', async () => {
    const { userId, modelIds } = await createFixture(1)
    await dbClient.db
      .update(schema.models)
      .set({ icon: { type: 'lobe', slug: 'a");background:url(evil' } as never })
      .where(eq(schema.models.id, modelIds[0]!))

    const model = (await modelServices.listEnabledModels(userId)).find(
      (m) => m.id === modelIds[0]!,
    )
    expect(model?.icon).toBeNull()
  })
})
