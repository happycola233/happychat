import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sizeTransition: vi.fn(),
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
    allowedEfforts: [],
    defaultEffort: null,
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
      activeEffort: null,
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
  beforeEach(() => mocks.sizeTransition.mockClear())

  it('transitions desktop width and height while keeping the mobile sheet height-only', () => {
    renderToStaticMarkup(<ModelControlMenu placement="up" align="end" variant="composer" />)

    expect(mocks.sizeTransition).toHaveBeenCalledTimes(2)
    expect(mocks.sizeTransition.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['model-a␟tree', { width: true, height: true }],
      ['model-a␟tree', { width: false, height: true }],
    ])
  })
})
