import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sizeTransition: vi.fn(),
  activeEffort: null as string | null,
  model: {
    id: 'model-a',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    kind: 'responses',
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
    description: null,
    tags: [],
    icon: null,
    groupId: null,
    allowedEfforts: [] as Array<{ value: string; description: string }>,
    defaultEffort: null as string | null,
    defaultWebSearch: false,
    defaultXSearch: false,
    defaultParams: null,
  },
}))

vi.mock('../hooks/useSizeTransition', () => ({
  useSizeTransition: mocks.sizeTransition,
}))
vi.mock('../hooks/useTriggerLabelWidth', () => ({ useTriggerLabelWidth: vi.fn() }))
vi.mock('../hooks/useModels', () => ({
  useModels: () => ({ data: [mocks.model] }),
  useModelGroups: () => ({ data: [] }),
}))
vi.mock('../store/chat', () => ({
  useChatPrefs: (selector: (state: object) => unknown) =>
    selector({
      activeModelId: mocks.model.id,
      setActiveModel: vi.fn(),
      activeEffort: mocks.activeEffort,
      activeWebSearch: null,
      activeXSearch: null,
    }),
}))
vi.mock('../store/settings', () => ({
  useSettings: (selector: (state: object) => unknown) =>
    selector({ preferences: { modelPickerView: 'tree' }, setPreference: vi.fn() }),
}))
vi.mock('../store/sidebar', () => ({ useIsMobile: () => false }))

import { ModelControlMenu } from './ModelControlMenu'

describe('ModelControlMenu size transition', () => {
  beforeEach(() => {
    mocks.sizeTransition.mockClear()
    mocks.model.kind = 'responses'
    mocks.model.capabilities.reasoning = false
    mocks.model.capabilities.web_search = false
    mocks.model.capabilities.x_search = false
    mocks.model.allowedEfforts = []
    mocks.model.defaultEffort = null
    mocks.model.defaultWebSearch = false
    mocks.model.defaultXSearch = false
    mocks.activeEffort = null
  })

  it('transitions desktop width and height while keeping the mobile sheet height-only', () => {
    renderToStaticMarkup(<ModelControlMenu placement="up" align="end" variant="composer" />)

    expect(mocks.sizeTransition).toHaveBeenCalledTimes(2)
    expect(mocks.sizeTransition.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['model-a␟tree', { width: true, height: true }],
      ['model-a␟tree', { width: false, height: true }],
    ])
  })

  it('hides stale Web/X Search capabilities from Chat Completions models', () => {
    mocks.model.kind = 'chat'
    mocks.model.capabilities.web_search = true
    mocks.model.capabilities.x_search = true
    mocks.model.defaultWebSearch = true
    mocks.model.defaultXSearch = true

    const html = renderToStaticMarkup(
      <ModelControlMenu placement="up" align="end" variant="composer" />,
    )

    expect(html).not.toContain('aria-label="联网已开启"')
    expect(html).not.toContain('aria-label="X 搜索已开启"')
  })

  it('keeps Web/X Search controls available for Responses models', () => {
    mocks.model.capabilities.web_search = true
    mocks.model.capabilities.x_search = true
    mocks.model.defaultWebSearch = true
    mocks.model.defaultXSearch = true

    const html = renderToStaticMarkup(
      <ModelControlMenu placement="up" align="end" variant="composer" />,
    )

    expect(html).toContain('aria-label="联网已开启"')
    expect(html).toContain('aria-label="X 搜索已开启"')
  })

  it('shows automatic instead of highlighting a model default when no effort is selected', () => {
    mocks.model.capabilities.reasoning = true
    mocks.model.allowedEfforts = [
      { value: 'low', description: '低' },
      { value: 'medium', description: '中' },
      { value: 'high', description: '高' },
    ]
    mocks.model.defaultEffort = 'medium'

    const html = renderToStaticMarkup(
      <ModelControlMenu placement="up" align="end" variant="composer" />,
    )

    expect(html).toContain('推理强度：自动（使用模型默认配置）')
    expect(html).not.toContain('推理强度：中（medium）')
  })

  it('shows the explicitly selected effort in the trigger', () => {
    mocks.model.capabilities.reasoning = true
    mocks.model.allowedEfforts = [
      { value: 'low', description: '低' },
      { value: 'high', description: '高' },
    ]
    mocks.model.defaultEffort = 'low'
    mocks.activeEffort = 'high'

    const html = renderToStaticMarkup(
      <ModelControlMenu placement="up" align="end" variant="composer" />,
    )

    expect(html).toContain('推理强度：高（high）')
  })
})
