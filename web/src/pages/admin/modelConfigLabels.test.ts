import { describe, expect, it } from 'vitest'
import type { ModelRouteDTO } from '@shared/types/api'
import { buildModelConfigHints } from './modelConfigLabels'

const route = (providerName: string): ModelRouteDTO => ({
  id: `route-${providerName}`,
  providerId: providerName,
  providerName,
  providerProtocol: 'openai',
  providerEnabled: true,
  upstreamModelId: null,
  priority: 0,
  weight: 1,
  enabled: true,
  costPricing: null,
})

const model = (id: string, displayName: string, groupId: string | null, provider: string) => ({
  id,
  displayName,
  modelId: 'gpt-x',
  groupId,
  routes: [route(provider)],
})

const groups = [
  { id: 'g1', name: '官方' },
  { id: 'g2', name: '免费' },
]

describe('buildModelConfigHints', () => {
  it('只为同名配置生成说明，并只列出彼此不同的部分', () => {
    const hints = buildModelConfigHints(
      [
        model('a-00000001', 'GPT X', 'g1', 'Alpha'),
        model('b-00000002', 'GPT X', 'g2', 'Beta'),
        model('c-00000003', 'Solo', 'g1', 'Alpha'),
      ],
      groups,
    )
    expect(hints.get('a-00000001')).toBe('官方 · Alpha')
    expect(hints.get('b-00000002')).toBe('免费 · Beta')
    expect(hints.has('c-00000003')).toBe(false)
  })

  it('分组、线路与模型 ID 都相同时附固定短编号', () => {
    const hints = buildModelConfigHints(
      [
        model('first-6a0d457b', 'GPT X', 'g1', 'Alpha'),
        model('second-5a147e98', 'GPT X', 'g1', 'Alpha'),
        model('third-3b136761', 'GPT X', 'g2', 'Beta'),
      ],
      groups,
    )
    expect(hints.get('first-6a0d457b')).toBe('官方 · Alpha · 配置 6a0d457b')
    expect(hints.get('second-5a147e98')).toBe('官方 · Alpha · 配置 5a147e98')
    expect(hints.get('third-3b136761')).toBe('免费 · Beta')
  })
})
