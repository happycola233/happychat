/** 下载和解码完成后才交给展示层，避免中间预览替换时出现空帧。 */
export function loadProgressiveImage(
  src: string,
  signal: AbortSignal,
): Promise<{ src: string; aspectRatio: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('图片加载已取消', 'AbortError'))
      return
    }

    const image = new Image()
    let settled = false
    let decoding = false

    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(new DOMException('图片加载已取消', 'AbortError'))
    const decodeImage = async () => {
      // 缓存命中后的 complete 检查与 load 事件可能先后触发，只解码一次。
      if (decoding || settled) return
      decoding = true
      try {
        await image.decode()
        if (settled) return
        if (image.naturalWidth === 0 || image.naturalHeight === 0) {
          throw new Error('图片尺寸无效')
        }
        settled = true
        cleanup()
        resolve({ src, aspectRatio: image.naturalWidth / image.naturalHeight })
      } catch (error) {
        fail(error)
      }
    }

    image.onload = () => void decodeImage()
    image.onerror = () => fail(new Error('图片加载失败'))
    signal.addEventListener('abort', onAbort, { once: true })
    image.src = src
    if (image.complete) void decodeImage()
  })
}
