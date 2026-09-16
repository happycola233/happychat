import { useEffect, useRef } from 'react'
import {
  advanceImageGenerationField,
  createImageGenerationField,
  sampleImageGenerationDot,
  type ImageGenerationField,
} from './imageGenerationField'

const DOT_SPACING = 14
const FRAME_INTERVAL_MS = 1000 / 30

/** 点阵只表达等待，不对应上游进度；整个动画留在 Canvas 中，不触发逐帧 React 更新。 */
export function ImageGenerationDots({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fieldRef = useRef<ImageGenerationField | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const context = canvas.getContext('2d')
    if (!context) return
    const field = (fieldRef.current ??= createImageGenerationField())
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionPreference.matches
    let pageVisible = document.visibilityState !== 'hidden'
    let inViewport = false
    let dark = document.documentElement.classList.contains('dark')
    let width = 0
    let height = 0
    let frameId: number | null = null
    let lastFrameAt: number | null = null
    let disposed = false

    const draw = () => {
      context.clearRect(0, 0, width, height)
      for (let y = DOT_SPACING / 2; y < height; y += DOT_SPACING) {
        for (let x = DOT_SPACING / 2; x < width; x += DOT_SPACING) {
          const dot = sampleImageGenerationDot(field, x / width, y / height, dark)
          context.beginPath()
          context.arc(x, y, dot.radius, 0, Math.PI * 2)
          context.fillStyle = dot.color
          context.globalAlpha = dot.opacity
          context.fill()
        }
      }
      context.globalAlpha = 1
    }
    const shouldAnimate = () =>
      !disposed && active && !reducedMotion && pageVisible && inViewport && width > 0 && height > 0
    const frame = (now: number) => {
      frameId = null
      if (!shouldAnimate()) return
      if (lastFrameAt === null) lastFrameAt = now
      const elapsed = now - lastFrameAt
      if (elapsed >= FRAME_INTERVAL_MS) {
        // 恢复可见时不追赶后台经过的时间，避免图案突然跳到另一个位置。
        advanceImageGenerationField(field, Math.min(elapsed, 80) / 1000)
        lastFrameAt = now
        draw()
      }
      frameId = window.requestAnimationFrame(frame)
    }
    const synchronizeAnimation = () => {
      if (shouldAnimate()) {
        if (frameId === null) frameId = window.requestAnimationFrame(frame)
      } else {
        if (frameId !== null) window.cancelAnimationFrame(frameId)
        frameId = null
        lastFrameAt = null
      }
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const pixelRatio = Math.min(window.devicePixelRatio, 2)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      draw()
      synchronizeAnimation()
    }
    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== 'hidden'
      synchronizeAnimation()
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      synchronizeAnimation()
    }
    const resizeObserver = new ResizeObserver(resize)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0)
      synchronizeAnimation()
    })
    const themeObserver = new MutationObserver(() => {
      const nextDark = document.documentElement.classList.contains('dark')
      if (nextDark !== dark) {
        dark = nextDark
        draw()
      }
    })

    resize()
    resizeObserver.observe(canvas)
    intersectionObserver.observe(canvas)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    motionPreference.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('resize', resize)

    return () => {
      disposed = true
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      themeObserver.disconnect()
      motionPreference.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  return (
    <div
      className="hc-image-waiting-field relative mt-2 aspect-[4/3]"
      data-active={active ? '' : undefined}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  )
}
