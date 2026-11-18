import { describe, expect, it } from 'vitest'
import {
  advanceThinkingGlyphField,
  createThinkingGlyphField,
  exciteThinkingGlyph,
  isThinkingGlyphSettled,
  rippleThinkingGlyph,
  sampleThinkingGlyphDots,
} from './thinkingGlyphField'

const FRAME = 1 / 60
// 恒大于放电概率阈值：只验证确定性的涟漪与衰减，不受随机放电干扰。
const neverFire = () => 0.999

describe('thinking glyph field', () => {
  it('lets a waiting highlight travel around the outer ring', () => {
    const field = createThinkingGlyphField(() => 0.5)
    advanceThinkingGlyphField(field, 'waiting', 0)
    const brightest = () =>
      field.dots.reduce(
        (best, dot, index) => (dot.brightness > field.dots[best]!.brightness ? index : best),
        0,
      )

    const first = brightest()
    advanceThinkingGlyphField(field, 'waiting', 1 / 9)
    expect(brightest()).not.toBe(first)
    expect(field.dots[4]!.brightness).toBeCloseTo(0.25)
  })

  it('caps how much one burst of text can excite the glyph', () => {
    const field = createThinkingGlyphField(() => 0.5)
    const before = field.energy
    exciteThinkingGlyph(field, 100_000)
    expect(field.energy - before).toBeLessThanOrEqual(0.5)
    exciteThinkingGlyph(field, 0)
    exciteThinkingGlyph(field, -20)
    expect(field.energy - before).toBeLessThanOrEqual(0.5)
  })

  it('ripples from the center to the edges and then the corners', () => {
    const field = createThinkingGlyphField(() => 0.5)
    rippleThinkingGlyph(field)
    advanceThinkingGlyphField(field, 'thinking', FRAME, neverFire)
    expect(field.dots[4]!.brightness).toBeGreaterThan(0.9)
    expect(field.dots[1]!.brightness).toBe(0)
    expect(field.dots[0]!.brightness).toBe(0)

    advanceThinkingGlyphField(field, 'thinking', 0.08, neverFire)
    expect(field.dots[1]!.brightness).toBeGreaterThan(0.7)
    expect(field.dots[0]!.brightness).toBe(0)

    advanceThinkingGlyphField(field, 'thinking', 0.08, neverFire)
    expect(field.dots[0]!.brightness).toBeGreaterThan(0.6)
    expect(field.rippleStartedAt).toBeNull()
  })

  it('collapses into the center and fades out while settling', () => {
    const field = createThinkingGlyphField(() => 0.5)
    for (let frame = 0; frame < 30; frame++) advanceThinkingGlyphField(field, 'thinking', FRAME)
    expect(isThinkingGlyphSettled(field)).toBe(false)

    for (let frame = 0; frame < 60; frame++) advanceThinkingGlyphField(field, 'settling', FRAME)
    expect(isThinkingGlyphSettled(field)).toBe(true)
    for (const dot of sampleThinkingGlyphDots(field, 'settling')) {
      expect(Math.abs(dot.x - 9)).toBeLessThan(0.1)
      expect(Math.abs(dot.y - 9)).toBeLessThan(0.1)
      expect(dot.opacity).toBeLessThan(0.01)
    }
  })
})
