import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  heightTransition: vi.fn(),
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

vi.mock('../hooks/useHeightTransition', () => ({
  useHeightTransition: mocks.heightTransition,
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

describe('ModelControlMenu height transition', () => {
  beforeEach(() => mocks.heightTransition.mockClear())

  it('uses model id and picker view in both desktop and mobile signatures', () => {
    renderToStaticMarkup(<ModelControlMenu placement="up" align="end" variant="composer" />)

    expect(mocks.heightTransition).toHaveBeenCalledTimes(2)
    expect(mocks.heightTransition.mock.calls.map((call) => call[1])).toEqual([
      'model-a␟tree',
      'model-a␟tree',
    ])
  })
})
