import { describe, expect, it } from 'vitest'
import { statsFilterSchema } from './admin'

describe('statsFilterSchema', () => {
  it('accepts semantic request results and keeps the legacy success query compatible', () => {
    expect(statsFilterSchema.parse({ result: 'refused', success: 'false' })).toEqual(
      expect.objectContaining({ result: 'refused', success: false }),
    )
  })

  it('rejects unknown request result values', () => {
    expect(statsFilterSchema.safeParse({ result: 'success' }).success).toBe(false)
  })
})
