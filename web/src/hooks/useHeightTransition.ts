import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const TRANSITION_MS = 220

/**
 * 内容切换导致容器尺寸突变时，让高度从旧值平滑过渡到新值（FLIP 式）。
 *
 * 与常驻测量方案不同：平时完全不锁定高度（保持 max-height / flex 弹性布局原样），
 * 仅在 dep 变化的那一次提交临时接管 height 做过渡，结束后交还给布局。
 * 用于模型选择聚合面板——切换模型后分区增减（思考/联网/图片参数）不再瞬间跳变。
 */
export function useHeightTransition(ref: RefObject<HTMLElement | null>, dep: unknown) {
  const lastDep = useRef(dep)
  const lastEl = useRef<HTMLElement | null>(null)
  const lastHeight = useRef<number | null>(null)
  const cleanupTimer = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // 弹层重新挂载（关闭再打开）：只重置基准，不做动画。
    if (lastEl.current !== el) {
      lastEl.current = el
      lastDep.current = dep
      lastHeight.current = el.offsetHeight
      return
    }

    if (lastDep.current === dep) {
      // 未在动画锁定期时持续采样，作为下次过渡的起点。
      if (!el.style.height) lastHeight.current = el.offsetHeight
      return
    }
    lastDep.current = dep

    // 解除可能存在的上一轮锁定，测出新内容的自然高度。
    window.clearTimeout(cleanupTimer.current)
    el.style.transition = 'none'
    el.style.height = ''
    el.style.overflow = ''
    const nextHeight = el.offsetHeight
    const prevHeight = lastHeight.current
    lastHeight.current = nextHeight
    if (
      prevHeight === null ||
      prevHeight === nextHeight ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      el.style.transition = ''
      return
    }

    // FLIP：钉回旧高度 → 强制回流 → 过渡到新高度 → 结束后交还布局。
    el.style.height = `${prevHeight}px`
    el.style.overflow = 'hidden'
    void el.offsetHeight
    el.style.transition = `height ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
    el.style.height = `${nextHeight}px`
    cleanupTimer.current = window.setTimeout(() => {
      el.style.transition = ''
      el.style.height = ''
      el.style.overflow = ''
      lastHeight.current = el.offsetHeight
    }, TRANSITION_MS + 30)
  })

  useEffect(() => () => window.clearTimeout(cleanupTimer.current), [])
}
