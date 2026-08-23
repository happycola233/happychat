import { describe, expect, it } from 'vitest'
import type { ModelDTO, ModelGroupDTO } from '@shared/types/api'
import {
  buildModelSections,
  filterModelSections,
  findSectionKeyOfModel,
  flattenSections,
  hasGroupStructure,
  openedSectionOnViewChange,
  resolveModelListView,
  sectionKey,
  sectionName,
  shouldShowModelParameters,
} from './modelGroups'

function model(id: string, overrides: Partial<ModelDTO> = {}): ModelDTO {
  return {
    id,
    modelId: `upstream-${id}`,
    displayName: id,
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
    ...overrides,
  }
}

function group(id: string, name: string, sort: number): ModelGroupDTO {
  return { id, name, icon: null, color: null, sort }
}

const openai = group('g-openai', 'OpenAI', 100)
const anthropic = group('g-anthropic', 'Anthropic', 200)

describe('buildModelSections', () => {
  it('groups models and keeps the server-provided group order', () => {
    const models = [
      model('claude', { groupId: anthropic.id }),
      model('gpt', { groupId: openai.id }),
      model('o3', { groupId: openai.id }),
    ]
    const sections = buildModelSections(models, [openai, anthropic])
    expect(sections.map((s) => s.group?.name)).toEqual(['OpenAI', 'Anthropic'])
    // 组内保持 models 数组原有顺序（即模型自身的 sort），不做二次排序。
    expect(sections[0]!.models.map((m) => m.id)).toEqual(['gpt', 'o3'])
  })

  it('puts ungrouped models last under a null group', () => {
    const models = [model('loose'), model('gpt', { groupId: openai.id })]
    const sections = buildModelSections(models, [openai])
    expect(sections).toHaveLength(2)
    expect(sections[1]!.group).toBeNull()
    expect(sectionName(sections[1]!)).toBe('未分组')
    expect(sectionKey(sections[1]!)).toBe('__ungrouped__')
  })

  it('drops empty groups', () => {
    const sections = buildModelSections([model('gpt', { groupId: openai.id })], [openai, anthropic])
    expect(sections.map((s) => s.group?.id)).toEqual([openai.id])
  })

  it('keeps models whose group id is unknown by moving them to ungrouped', () => {
    // 分组刚被删、模型列表缓存还没刷新时会出现这种状态：绝不能凭空丢模型。
    const sections = buildModelSections([model('orphan', { groupId: 'deleted-group' })], [openai])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.group).toBeNull()
    expect(sections[0]!.models.map((m) => m.id)).toEqual(['orphan'])
  })

  it('returns no sections for an empty model list', () => {
    expect(buildModelSections([], [openai])).toEqual([])
  })
})

describe('hasGroupStructure', () => {
  it('is false when every model is ungrouped', () => {
    const sections = buildModelSections([model('a'), model('b')], [])
    expect(hasGroupStructure(sections)).toBe(false)
  })

  it('is true once any real group is present', () => {
    const sections = buildModelSections([model('gpt', { groupId: openai.id })], [openai])
    expect(hasGroupStructure(sections)).toBe(true)
  })
})

describe('resolveModelListView', () => {
  it('fully falls back to a plain list when every model is ungrouped', () => {
    const sections = buildModelSections([model('a'), model('b')], [])
    expect(resolveModelListView('tree', sections)).toBe('flat')
  })

  it('keeps the preferred view when a real group exists', () => {
    const sections = buildModelSections([model('gpt', { groupId: openai.id })], [openai])
    expect(resolveModelListView('tree', sections)).toBe('tree')
    expect(resolveModelListView('flat', sections)).toBe('flat')
  })
})

describe('filterModelSections', () => {
  const sections = buildModelSections(
    [
      model('gpt', { groupId: openai.id, displayName: 'GPT 5.6' }),
      model('o3', { groupId: openai.id, displayName: 'o3 mini' }),
      model('claude', { groupId: anthropic.id, displayName: 'Claude Sonnet 5' }),
      model('local', { displayName: '本地模型' }),
    ],
    [openai, anthropic],
  )

  it('returns everything for an empty keyword', () => {
    expect(filterModelSections(sections, '  ')).toBe(sections)
  })

  it('matches display names case-insensitively', () => {
    const result = filterModelSections(sections, 'gpt')
    expect(result).toHaveLength(1)
    expect(result[0]!.models.map((m) => m.id)).toEqual(['gpt'])
  })

  it('matches the upstream model id', () => {
    expect(flattenSections(filterModelSections(sections, 'upstream-claude'))).toHaveLength(1)
  })

  it('keeps a whole group when the group name matches', () => {
    // 输入「OpenAI」时用户想看整个分组，而不是只剩名字里带 OpenAI 的那几个。
    const result = filterModelSections(sections, 'openai')
    expect(result).toHaveLength(1)
    expect(result[0]!.models.map((m) => m.id)).toEqual(['gpt', 'o3'])
  })

  it('drops sections that end up empty', () => {
    expect(filterModelSections(sections, '本地')).toEqual([
      { group: null, models: [expect.objectContaining({ id: 'local' })] },
    ])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterModelSections(sections, 'zzz')).toEqual([])
  })
})

describe('findSectionKeyOfModel', () => {
  const sections = buildModelSections(
    [model('gpt', { groupId: openai.id }), model('loose')],
    [openai],
  )

  it('finds the group containing the model', () => {
    expect(findSectionKeyOfModel(sections, 'gpt')).toBe(openai.id)
    expect(findSectionKeyOfModel(sections, 'loose')).toBe('__ungrouped__')
  })

  it('returns null for unknown or missing ids', () => {
    expect(findSectionKeyOfModel(sections, null)).toBeNull()
    expect(findSectionKeyOfModel(sections, 'nope')).toBeNull()
  })
})

describe('openedSectionOnViewChange', () => {
  const sections = buildModelSections(
    [model('model-a', { groupId: openai.id }), model('model-b', { groupId: anthropic.id })],
    [openai, anthropic],
  )

  it('uses the latest active model when entering tree view', () => {
    expect(openedSectionOnViewChange('flat', 'tree', openai.id, sections, 'model-b')).toBe(
      anthropic.id,
    )
  })

  it('reopens the selected-model group after leaving a deliberately collapsed tree root', () => {
    const openedInFlat = openedSectionOnViewChange(
      'tree',
      'flat',
      null,
      sections,
      'model-a',
    )

    expect(openedInFlat).toBeNull()
    expect(openedSectionOnViewChange('flat', 'tree', openedInFlat, sections, 'model-a')).toBe(
      openai.id,
    )
  })

  it('does not override deliberate navigation while already in tree view', () => {
    expect(openedSectionOnViewChange('tree', 'tree', openai.id, sections, 'model-b')).toBe(
      openai.id,
    )
  })
})

describe('shouldShowModelParameters', () => {
  it('hides selected-model parameters at the tree root', () => {
    // 是否已有选中模型不参与判断：根层只展示分组，不应泄露文本或画图模型参数。
    expect(shouldShowModelParameters('tree', false, false)).toBe(false)
  })

  it('shows parameters after entering a group', () => {
    expect(shouldShowModelParameters('tree', false, true)).toBe(true)
  })

  it('keeps parameters visible in flat and search result lists', () => {
    expect(shouldShowModelParameters('flat', false, false)).toBe(true)
    expect(shouldShowModelParameters('tree', true, false)).toBe(true)
  })
})
