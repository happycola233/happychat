import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeaderDrafts, parseHeaderDrafts } from './providerHeaderDrafts'

afterEach(() => vi.unstubAllGlobals())

describe('provider header drafts', () => {
  it('loads header drafts on HTTP origins where crypto.randomUUID is unavailable', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues })
    const drafts = createHeaderDrafts({ 'X-Route': 'first', 'X-Auth': 'second' })
    expect(drafts).toHaveLength(2)
    expect(drafts[0]?.id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    )
    expect(drafts[0]?.id).not.toBe(drafts[1]?.id)
    expect(parseHeaderDrafts(drafts)).toEqual({ 'X-Route': 'first', 'X-Auth': 'second' })
  })
  it('rejects duplicate names before converting them to an object', () => {
    expect(() =>
      parseHeaderDrafts([
        { id: '1', name: 'X-Token', value: 'a' },
        { id: '2', name: ' x-token ', value: 'b' },
      ]),
    ).toThrow('重复')
  })
  it('requires an explicit removal for empty rows instead of silently discarding a secret value', () => {
    expect(() => parseHeaderDrafts([{ id: '1', name: '', value: 'key' }])).toThrow('填写')
  })
  it('keeps allowed header values exact and clears all headers with no rows', () => {
    expect(parseHeaderDrafts([{ id: '1', name: ' X-Route ', value: 'route-value' }])).toEqual({
      'X-Route': 'route-value',
    })
    expect(parseHeaderDrafts([])).toEqual({})
  })
})
