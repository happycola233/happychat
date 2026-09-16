import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadProgressiveImage } from './loadProgressiveImage'

function deferredDecode() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let images: MockImage[]
let cachedDimensions: { width: number; height: number } | null

class MockImage {
  src = ''
  complete = Boolean(cachedDimensions)
  naturalWidth = cachedDimensions?.width ?? 0
  naturalHeight = cachedDimensions?.height ?? 0
  onload: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  decoded = deferredDecode()
  decode = vi.fn(() => this.decoded.promise)

  constructor() {
    images.push(this)
  }

  load(width = 1200, height = 800) {
    this.complete = true
    this.naturalWidth = width
    this.naturalHeight = height
    this.onload?.(new Event('load'))
  }
}

beforeEach(() => {
  images = []
  cachedDimensions = null
  vi.stubGlobal('Image', MockImage)
})

afterEach(() => vi.unstubAllGlobals())

describe('loadProgressiveImage', () => {
  it('waits for both load and decode, then returns the natural aspect ratio and cleans listeners', async () => {
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const result = loadProgressiveImage('/preview.png', controller.signal)
    const resolved = vi.fn()
    void result.then(resolved)
    const image = images[0]!
    expect(image.src).toBe('/preview.png')
    expect(image.decode).not.toHaveBeenCalled()

    image.load()
    expect(image.decode).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()

    image.decoded.resolve()
    await expect(result).resolves.toEqual({ src: '/preview.png', aspectRatio: 1.5 })
    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('decodes an already complete cached image once even if a load event also arrives', async () => {
    cachedDimensions = { width: 800, height: 1200 }
    const result = loadProgressiveImage('/cached.png', new AbortController().signal)
    const image = images[0]!
    expect(image.decode).toHaveBeenCalledOnce()
    image.onload?.(new Event('load'))
    expect(image.decode).toHaveBeenCalledOnce()
    image.decoded.resolve()
    await expect(result).resolves.toEqual({ src: '/cached.png', aspectRatio: 2 / 3 })
  })

  it('rejects an already aborted signal without starting an image load', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadProgressiveImage('/unused.png', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(images).toHaveLength(0)
  })

  it.each(['before load', 'during decode'] as const)(
    'rejects cancellation %s, clears listeners and ignores late load/decode completion',
    async (phase) => {
      const controller = new AbortController()
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
      const result = loadProgressiveImage('/preview.png', controller.signal)
      const resolved = vi.fn()
      void result.then(resolved, () => {})
      const image = images[0]!
      const lateLoad = image.onload
      if (phase === 'during decode') image.load()
      const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await rejection
      expect(image.onload).toBeNull()
      expect(image.onerror).toBeNull()
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))

      lateLoad?.(new Event('load'))
      image.decoded.resolve()
      await Promise.resolve()
      expect(resolved).not.toHaveBeenCalled()
      expect(image.decode).toHaveBeenCalledTimes(phase === 'during decode' ? 1 : 0)
    },
  )

  it('rejects a load error and removes event handlers', async () => {
    const result = loadProgressiveImage('/broken.png', new AbortController().signal)
    const rejection = expect(result).rejects.toThrow('图片加载失败')
    const image = images[0]!
    image.onerror?.(new Event('error'))
    await rejection
    expect(image.decode).not.toHaveBeenCalled()
    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
  })

  it('preserves a decoding failure and removes event handlers', async () => {
    const result = loadProgressiveImage('/invalid.png', new AbortController().signal)
    const decodeError = new Error('Cannot decode image')
    const rejection = expect(result).rejects.toBe(decodeError)
    const image = images[0]!
    image.load()
    image.decoded.reject(decodeError)
    await rejection
    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
  })

  it.each([
    [0, 0],
    [0, 800],
    [1200, 0],
  ])('rejects unusable natural dimensions %s × %s', async (width, height) => {
    const result = loadProgressiveImage('/invalid-size.png', new AbortController().signal)
    const rejection = expect(result).rejects.toThrow('图片尺寸无效')
    const image = images[0]!
    image.load(width, height)
    image.decoded.resolve()
    await rejection
  })
})
