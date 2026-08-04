import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const TRANSITION_MS = 220
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

interface SizeTransitionOptions {
  /** 是否接管并过渡元素宽度。 */
  width: boolean
  /** 是否接管并过渡元素高度。 */
  height: boolean
}

interface ElementSize {
  width: number
  height: number
}

function measureElement(element: HTMLElement): ElementSize {
  return {
    // offset 尺寸不受弹层入场 transform 影响，同时能读到在途 CSS 尺寸过渡的当前布局值。
    width: element.offsetWidth,
    height: element.offsetHeight,
  }
}

/**
 * 内容切换导致容器尺寸突变时，让指定尺寸从旧值平滑过渡到新值（FLIP 式）。
 *
 * 与常驻测量方案不同：平时不锁定自然尺寸（保留 fit-content / max-height / flex 布局），
 * 仅在 signature 变化的那一次提交临时接管 width / height，结束后立即交还给布局。
 * 连续切换时从在途动画的当前布局尺寸续接，不会先跳回上一轮终点。
 */
export function useSizeTransition(
  ref: RefObject<HTMLElement | null>,
  signature: unknown,
  { width: transitionWidth, height: transitionHeight }: SizeTransitionOptions,
) {
  const lastSignature = useRef(signature)
  const lastElement = useRef<HTMLElement | null>(null)
  const lastNaturalSize = useRef<ElementSize | null>(null)
  const cleanupTimer = useRef<number | undefined>(undefined)

  // 无依赖数组：每次提交后采样自然尺寸，只在 signature 变化时接管过渡。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    // 弹层重新挂载（关闭再打开）：只建立自然尺寸基线，不播放尺寸动画。
    if (lastElement.current !== element) {
      lastElement.current = element
      lastSignature.current = signature
      lastNaturalSize.current = measureElement(element)
      return
    }

    const transitionInProgress =
      (transitionWidth && Boolean(element.style.width)) ||
      (transitionHeight && Boolean(element.style.height))

    if (lastSignature.current === signature) {
      // 非锁定期持续吸收字体加载、视口约束等非交互性重排，作为下次过渡起点。
      if (!transitionInProgress) lastNaturalSize.current = measureElement(element)
      return
    }
    lastSignature.current = signature

    // 在途切换先读取当前布局尺寸；静止切换则使用上一次提交保存的自然尺寸。
    const currentSize = transitionInProgress ? measureElement(element) : lastNaturalSize.current

    // 解除上一轮锁定，测出新内容在 fit-content / flex 约束下的真实目标尺寸。
    window.clearTimeout(cleanupTimer.current)
    element.style.transition = 'none'
    if (transitionWidth) element.style.width = ''
    if (transitionHeight) element.style.height = ''
    element.style.overflow = ''
    const targetSize = measureElement(element)
    lastNaturalSize.current = targetSize

    const widthChanged =
      transitionWidth && currentSize !== null && currentSize.width !== targetSize.width
    const heightChanged =
      transitionHeight && currentSize !== null && currentSize.height !== targetSize.height
    if (
      currentSize === null ||
      (!widthChanged && !heightChanged) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      element.style.transition = ''
      return
    }

    // FLIP：钉回当前视觉尺寸 → 强制回流 → 同步过渡到目标尺寸 → 交还自然布局。
    // 即使某一轴数值未变，也在另一轴运动期间锁住它，避免内容重排制造额外跳动。
    if (transitionWidth) element.style.width = `${currentSize.width}px`
    if (transitionHeight) element.style.height = `${currentSize.height}px`
    element.style.overflow = 'hidden'
    void element.offsetWidth

    const transitions: string[] = []
    if (widthChanged) transitions.push(`width ${TRANSITION_MS}ms ${EASING}`)
    if (heightChanged) transitions.push(`height ${TRANSITION_MS}ms ${EASING}`)
    element.style.transition = transitions.join(', ')
    if (transitionWidth) element.style.width = `${targetSize.width}px`
    if (transitionHeight) element.style.height = `${targetSize.height}px`

    cleanupTimer.current = window.setTimeout(() => {
      element.style.transition = ''
      if (transitionWidth) element.style.width = ''
      if (transitionHeight) element.style.height = ''
      element.style.overflow = ''
      lastNaturalSize.current = measureElement(element)
    }, TRANSITION_MS + 30)
  })

  useEffect(() => () => window.clearTimeout(cleanupTimer.current), [])
}
