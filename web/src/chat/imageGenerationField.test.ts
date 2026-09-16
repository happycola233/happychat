import { describe, expect, it, vi } from 'vitest'
import {
  advanceImageGenerationField,
  createImageGenerationField,
  sampleImageGenerationDot,
} from './imageGenerationField'

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('image generation dot field', () => {
  it('has a deterministic first frame and never draws fresh randomness during animation', () => {
    const random = vi.fn(seededRandom(42))
    const field = createImageGenerationField(random)
    const twin = createImageGenerationField(seededRandom(42))
    const initialRandomCalls = random.mock.calls.length
    expect(field).toEqual(twin)

    for (let frame = 0; frame < 30; frame++) {
      advanceImageGenerationField(field, 1 / 30)
      advanceImageGenerationField(twin, 1 / 30)
      expect(sampleImageGenerationDot(field, 0.3, 0.7, true)).toEqual(
        sampleImageGenerationDot(twin, 0.3, 0.7, true),
      )
    }
    expect(random).toHaveBeenCalledTimes(initialRandomCalls)
  })

  it('keeps dots visible, restrained and finite across the canvas in either theme', () => {
    for (const seed of [1, 42, 123456]) {
      const field = createImageGenerationField(seededRandom(seed))
      for (const secondsDelta of [0, 5, 25, 570, 3000]) {
        advanceImageGenerationField(field, secondsDelta)
        for (const dark of [false, true]) {
          for (let row = 0; row <= 10; row++) {
            for (let column = 0; column <= 10; column++) {
              const dot = sampleImageGenerationDot(field, column / 10, row / 10, dark)
              expect(dot.radius).toBeGreaterThanOrEqual(0.6)
              expect(dot.radius).toBeLessThanOrEqual(2.8)
              expect(dot.opacity).toBeGreaterThan(0)
              expect(dot.opacity).toBeLessThanOrEqual(0.82)
              expect(dot.color).toMatch(/^hsl\(\d+\.\d{2} \d+% \d+%\)$/)
            }
          }
        }
      }
    }
  })

  it('changes continuously and gives the same result at the same elapsed time', () => {
    const field = createImageGenerationField(seededRandom(7))
    const direct = createImageGenerationField(seededRandom(7))
    const before = sampleImageGenerationDot(field, 0.37, 0.62, false)
    advanceImageGenerationField(field, 1 / 60)
    const nextFrame = sampleImageGenerationDot(field, 0.37, 0.62, false)
    for (const key of ['radius', 'opacity'] as const) {
      expect(Math.abs(before[key] - nextFrame[key])).toBeLessThan(0.025)
    }

    for (let frame = 1; frame < 600; frame++) advanceImageGenerationField(field, 1 / 60)
    advanceImageGenerationField(direct, 10)
    const steppedDot = sampleImageGenerationDot(field, 0.37, 0.62, false)
    const directDot = sampleImageGenerationDot(direct, 0.37, 0.62, false)
    for (const key of ['radius', 'opacity'] as const) {
      expect(steppedDot[key]).toBeCloseTo(directDot[key], 10)
    }
    expect(steppedDot.color).toBe(directDot.color)
    expect(steppedDot).not.toEqual(before)
  })

  it('keeps spatial and color variation in the static reduced-motion frame', () => {
    const field = createImageGenerationField(seededRandom(11))
    const points = [
      [0.1, 0.1],
      [0.3, 0.4],
      [0.6, 0.7],
      [0.9, 0.9],
    ] as const
    const lightDots = points.map(([x, y]) => sampleImageGenerationDot(field, x, y, false))
    const darkDots = points.map(([x, y]) => sampleImageGenerationDot(field, x, y, true))
    expect(new Set(lightDots.map((dot) => dot.color)).size).toBeGreaterThan(2)
    const radii = lightDots.map((dot) => dot.radius)
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.4)
    for (let index = 0; index < points.length; index++) {
      expect(darkDots[index]!.opacity).toBeGreaterThan(lightDots[index]!.opacity)
      expect(darkDots[index]!.radius).toBe(lightDots[index]!.radius)
    }
  })

  it('keeps the rectangular grid visible at every edge while highlights travel within it', () => {
    const field = createImageGenerationField(seededRandom(29))
    for (const elapsed of [0, 3, 20, 60]) {
      advanceImageGenerationField(field, elapsed)
      const edges = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 0.5],
        [1, 0.5],
      ] as const
      const dots = edges.map(([x, y]) => sampleImageGenerationDot(field, x, y, true))
      for (const dot of dots) {
        expect(dot.radius).toBeGreaterThanOrEqual(0.64)
        expect(dot.opacity).toBeGreaterThanOrEqual(0.18)
      }
      expect(new Set(dots.map((dot) => dot.color)).size).toBeGreaterThan(2)
    }
  })
})
