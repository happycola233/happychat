import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelParams, ReasoningEffortOption } from '@shared/types/domain'

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
    allowedEfforts: [] as ReasoningEffortOption[],
    defaultEffort: null as string | null,
    defaultWebSearch: false,
    defaultXSearch: false,
    defaultParams: null as ModelParams | null,
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
    mocks.activeEffort = null
    mocks.model.capabilities.reasoning = false
    mocks.model.allowedEfforts = []
    mocks.model.defaultEffort = null
    mocks.model.defaultParams = null
    mocks.model.capabilities.web_search = false
    mocks.model.capabilities.x_search = false
    mocks.model.defaultWebSearch = false
    mocks.model.defaultXSearch = false
  })

  it('transitions desktop width and height while keeping the mobile sheet height-only', () => {
    renderToStaticMarkup(<ModelControlMenu placement="up" align="end" variant="composer" />)

    expect(mocks.sizeTransition).toHaveBeenCalledTimes(2)
    expect(mocks.sizeTransition.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['model-a␟tree', { width: true, height: true }],
      ['model-a␟tree', { width: false, height: true }],
    ])
  })

  it('asks for a reasoning level instead of displaying automatic mode', () => {
    mocks.model.capabilities.reasoning = true
    mocks.model.allowedEfforts = [{ value: 'high', description: '高' }]
    mocks.activeEffort = 'removed-level'

    const html = renderToStaticMarkup(
      <ModelControlMenu placement="up" align="end" variant="composer" />,
    )
    expect(html).toContain('选择推理强度')
    expect(html).toContain('推理强度：请选择')
    expect(html).not.toContain('自动')
  })

  it.each(['selected', 'defaultEffort', 'defaultParams'] as const)(
    'displays the supported %s level in the trigger',
    (source) => {
      mocks.model.capabilities.reasoning = true
      mocks.model.allowedEfforts = [{ value: 'none', description: '不推理' }]
      if (source === 'selected') mocks.activeEffort = 'none'
      if (source === 'defaultEffort') mocks.model.defaultEffort = 'none'
      if (source === 'defaultParams') mocks.model.defaultParams = { reasoning_effort: 'none' }

      const html = renderToStaticMarkup(
        <ModelControlMenu placement="up" align="end" variant="composer" />,
      )
      expect(html).toContain('推理强度：不推理（none）')
      expect(html).not.toContain('选择推理强度')
    },
  )

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
})
