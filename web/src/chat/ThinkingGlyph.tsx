import { memo, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  advanceThinkingGlyphField,
  createThinkingGlyphField,
  exciteThinkingGlyph,
  isThinkingGlyphSettled,
  rippleThinkingGlyph,
  sampleThinkingGlyphDots,
  staticThinkingGlyphDots,
  THINKING_GLYPH_VIEWBOX,
  type ThinkingGlyphField,
  type ThinkingGlyphPhase,
} from './thinkingGlyphField'

interface Props {
  phase: ThinkingGlyphPhase
  /** 已到达的过程文字总量；增长时按增量提升点阵活跃度。 */
  activity?: number
  /** 值变化时从中心荡开一圈涟漪（新小标题到达）。 */
  rippleKey?: string | null
  /** 边长像素，默认 18；Artifact 顶栏等紧凑区域可按需缩小。 */
  size?: number
  testId?: string
  className?: string
}

/**
 * 思考状态点阵图标。颜色取自 currentColor，随主题切换重读；
 * 动画只在 Canvas 中逐帧推进，不触发 React 重渲染。
 * 减少动态效果、页面隐藏、滚出视口或收束完毕时停帧。
 */
export const ThinkingGlyph = memo(function ThinkingGlyph({
  phase,
  activity = 0,
  rippleKey = null,
  size = 18,
  testId = 'thinking-glyph',
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fieldRef = useRef<ThinkingGlyphField | null>(null)
  const phaseRef = useRef(phase)
  const activityRef = useRef(activity)
  const rippleKeyRef = useRef(rippleKey)
  const synchronizeRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current!
    const context = canvas.getContext('2d')
    if (!context) return
    const field = (fieldRef.current ??= createThinkingGlyphField())
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionPreference.matches
    let pageVisible = document.visibilityState !== 'hidden'
    let inViewport = false
    // 画布实际渲染出的边长；为 0 时（未布局或被隐藏）不启动动画。
    let renderedSize = 0
    let color = window.getComputedStyle(canvas).color
    let frameId: number | null = null
    let lastFrameAt: number | null = null

    const draw = () => {
      context.clearRect(0, 0, THINKING_GLYPH_VIEWBOX, THINKING_GLYPH_VIEWBOX)
      const settling = phaseRef.current === 'settling'
      const dots = reducedMotion
        ? settling
          ? []
          : staticThinkingGlyphDots()
        : sampleThinkingGlyphDots(field, phaseRef.current)
      context.fillStyle = color
      for (const dot of dots) {
        context.globalAlpha = dot.opacity
        context.beginPath()
        context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
    }
    const shouldAnimate = () =>
      !reducedMotion &&
      pageVisible &&
      inViewport &&
      renderedSize > 0 &&
      !(phaseRef.current === 'settling' && isThinkingGlyphSettled(field))
    const frame = (now: number) => {
      frameId = null
      // 恢复可见时不追赶后台经过的时间，避免点阵瞬间跳到另一种状态。
      const elapsedMs = lastFrameAt === null ? 0 : Math.min(now - lastFrameAt, 80)
      lastFrameAt = now
      advanceThinkingGlyphField(field, phaseRef.current, elapsedMs / 1000)
      draw()
      if (shouldAnimate()) frameId = window.requestAnimationFrame(frame)
      else lastFrameAt = null
    }
    const synchronize = () => {
      if (shouldAnimate()) {
        if (frameId === null) frameId = window.requestAnimationFrame(frame)
        return
      }
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
      lastFrameAt = null
      draw()
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      renderedSize = rect.width
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 3)
      canvas.width = Math.round(rect.width * pixelRatio)
      canvas.height = Math.round(rect.height * pixelRatio)
      const scale = canvas.width / THINKING_GLYPH_VIEWBOX
      context.setTransform(scale, 0, 0, scale, 0, 0)
      draw()
      synchronize()
    }
    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== 'hidden'
      synchronize()
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      synchronize()
    }
    const resizeObserver = new ResizeObserver(resize)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = Boolean(entry?.isIntersecting)
      synchronize()
    })
    const themeObserver = new MutationObserver(() => {
      color = window.getComputedStyle(canvas).color
      draw()
    })

    synchronizeRef.current = synchronize
    resize()
    resizeObserver.observe(canvas)
    intersectionObserver.observe(canvas)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    motionPreference.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      synchronizeRef.current = () => undefined
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      themeObserver.disconnect()
      motionPreference.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    phaseRef.current = phase
    synchronizeRef.current()
  }, [phase])

  useEffect(() => {
    const arrived = activity - activityRef.current
    activityRef.current = activity
    if (fieldRef.current) exciteThinkingGlyph(fieldRef.current, arrived)
  }, [activity])

  useEffect(() => {
    if (rippleKey === rippleKeyRef.current) return
    rippleKeyRef.current = rippleKey
    if (fieldRef.current && rippleKey !== null) rippleThinkingGlyph(fieldRef.current)
  }, [rippleKey])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid={testId}
      data-phase={phase}
      style={{ width: size, height: size }}
      className={clsx('block', className)}
    />
  )
})
