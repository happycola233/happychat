import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelDTO, PublicUser } from '@shared/types/api'
import { DEFAULT_MODEL_USAGE_NOTICE } from '@shared/schemas/user-notices'
import { ModelUsageNotice } from './ModelUsageNotice'

const auth: { data: Partial<PublicUser> | null } = { data: { id: 'user-a' } }
vi.mock('../hooks/useAuth', () => ({ useMe: () => auth }))

const model = {
  id: 'notice-model',
  displayName: '深度思考',
  usageNotice: { ...DEFAULT_MODEL_USAGE_NOTICE, enabled: true, body: '可以稍后回来查看回复。' },
} as ModelDTO
const storage = new Map<string, string>()

beforeEach(() => {
  auth.data = { id: 'user-a' }
  storage.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null })
})
afterEach(() => vi.unstubAllGlobals())

describe('模型使用提示', () => {
  it('首次选用显示完整提示与确认入口', () => {
    const html = renderToStaticMarkup(<ModelUsageNotice model={model} />)
    expect(html).toContain('可以稍后回来查看回复。')
    expect(html).toContain('知道了')
  })

  it('确认只属于当前账号，管理员更新正文后重新展示', () => {
    storage.set('happychat-model-notice:user-a:notice-model', JSON.stringify(model.usageNotice))
    expect(renderToStaticMarkup(<ModelUsageNotice model={model} />)).toBe('')
    expect(
      renderToStaticMarkup(
        <ModelUsageNotice
          model={{ ...model, usageNotice: { ...model.usageNotice!, body: '新的提醒' } }}
        />,
      ),
    ).toContain('新的提醒')
    auth.data = { id: 'user-b' }
    expect(renderToStaticMarkup(<ModelUsageNotice model={model} />)).toContain('知道了')
  })

  it('常驻提示遵循关闭开关，不会因曾经确认而隐藏', () => {
    const persistent = {
      ...model,
      usageNotice: { ...model.usageNotice!, frequency: 'always' as const, dismissible: false },
    }
    storage.set(
      'happychat-model-notice:user-a:notice-model',
      JSON.stringify(persistent.usageNotice),
    )
    const html = renderToStaticMarkup(<ModelUsageNotice model={persistent} />)
    expect(html).toContain('可以稍后回来查看回复。')
    expect(html).not.toContain('知道了')
    expect(html).not.toContain('关闭使用提示')
  })
})
