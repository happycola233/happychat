import { describe, expect, it } from 'vitest'
import type { ModelRouteDTO } from '@shared/types/api'
import {
  describeModelRoutes,
  modelProviderIds,
  newRouteDraft,
  routeDraftsToInput,
  routeTiers,
  routesProtocol,
} from './modelRoutes'

const route = (patch: Partial<ModelRouteDTO>): ModelRouteDTO => ({
  id: 'r',
  providerId: 'p',
  providerName: '主供应商',
  providerProtocol: 'openai',
  providerEnabled: true,
  upstreamModelId: null,
  priority: 0,
  weight: 1,
  enabled: true,
  costPricing: null,
  ...patch,
})

describe('route helpers', () => {
  it('groups enabled routes into priority tiers with weight shares', () => {
    const { tiers, disabled } = routeTiers([
      { key: 'a', label: 'A', priority: 0, weight: 3, enabled: true },
      { key: 'b', label: 'B', priority: 0, weight: 1, enabled: true },
      { key: 'c', label: 'C', priority: 10, weight: 1, enabled: true },
      { key: 'd', label: 'D', priority: 99, weight: 1, enabled: false },
    ])
    expect(tiers.map((tier) => tier.priority)).toEqual([10, 0])
    expect(tiers[1]!.items.map((item) => [item.key, item.share])).toEqual([
      ['a', 0.75],
      ['b', 0.25],
    ])
    expect(disabled.map((item) => item.key)).toEqual(['d'])
  })

  it('converts drafts with the shared schema and reports the offending row', () => {
    const blankProvider = newRouteDraft('')
    expect(routeDraftsToInput([newRouteDraft('p1'), blankProvider])).toEqual({
      ok: false,
      message: '线路 2：请选择供应商',
    })
    const ok = routeDraftsToInput([{ ...newRouteDraft('p1'), upstreamModelId: '  ' }])
    expect(ok).toMatchObject({ ok: true, routes: [{ providerId: 'p1', upstreamModelId: null }] })
  })

  it('detects mixed provider protocols', () => {
    const providers = [
      { id: 'o', protocol: 'openai' as const },
      { id: 'a', protocol: 'anthropic' as const },
    ]
    expect(routesProtocol([{ providerId: 'o' }], providers)).toEqual({
      protocol: 'openai',
      mixed: false,
    })
    expect(routesProtocol([{ providerId: 'a' }, { providerId: 'o' }], providers)).toEqual({
      protocol: 'anthropic',
      mixed: true,
    })
  })

  it('summarizes routes by the preferred runnable provider', () => {
    expect(describeModelRoutes({ routes: [] })).toBe('未配置线路')
    expect(describeModelRoutes({ routes: [route({ enabled: false })] })).toBe('线路均已停用')
    const routes = [
      route({ id: 'backup', providerId: 'b', providerName: '备用', priority: 0 }),
      route({ id: 'primary', providerId: 'a', providerName: '主用', priority: 5 }),
      route({ id: 'paused', providerId: 'c', providerEnabled: false }),
    ]
    expect(describeModelRoutes({ routes })).toBe('主用 等 2 条线路')
    expect(modelProviderIds({ routes })).toEqual(['b', 'a', 'c'])
  })
})
