import { describe, expect, it } from 'vitest'
import { tableScroll } from './tableStyles'

describe('tableScroll', () => {
  it('keeps admin tables horizontally scrollable without blocking vertical page scroll', () => {
    expect(tableScroll).toContain('overflow-x-auto')
    expect(tableScroll).not.toContain('[touch-action:pan-x]')
  })
})
