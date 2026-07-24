import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** 宽度过渡时长与曲线，与选择器面板高度过渡（useHeightTransition）保持一致的运动语言。 */
const TRANSITION_MS = 220
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** 宽度差小于此像素视为无变化，避免子像素抖动触发无意义的过渡。 */
const EPSILON_PX = 0.5

interface Options {
  /** 宽度参与过渡的外层元素（`overflow:hidden`）；切换时被 JS 临时接管 `width`，静止时交还布局。 */
  wrapRef: RefObject<HTMLElement | null>
  /** 承载最终排版的内层元素（`width:max-content`）；其宽度恒为「目标宽度」，不随外层被钉窄而收缩。 */
  contentRef: RefObject<HTMLElement | null>
  /** 标签内容签名：变化即触发一次宽度过渡（模型名 / 思考档位 / 联网地球的增减）。 */
  signature: string
  /** 是否已就绪（模型已解析）。未就绪时只保持自然宽度、不建立基线、不做动画。 */
  enabled: boolean
}

/**
 * 让触发器胶囊在内容变化时「平滑改变宽度」而非瞬间跳变（桌面端与移动端触发器共用）。
 *
 * 关键设计（逐条对应历史踩坑）：
 * - **内层恒为最终排版**：`contentRef` 始终以 `max-content` 排版，其宽度即最终宽度。
 *   因此即便外层被钉在旧的窄宽度上，新文字也不会被挤进窄空间而出现省略号。
 * - **只有外层参与过渡**：只动 `wrapRef` 的 `width`；下拉箭头在 `wrapRef` 之外，扩宽时绝不被裁。
 * - **异步加载不误触发**：首次就绪 / 元素重挂载 / reduced-motion 一律直接落位（只建立基线），
 *   避免模型异步到达时从占位宽度「跳入」；只有已建立基线后、签名再变化才做动画。
 * - **连续切换顺滑接续**：过渡起点取外层「当前实际渲染宽度」（getBoundingClientRect），
 *   即便上一段过渡尚未结束也能从当前视觉宽度平滑续接，不产生回跳。
 *
 * 结束后把内联 `width`/`transition` 清空、交还给弹性布局（外层重新以内层自然宽度为准）。
 */
export function useTriggerLabelWidth({ wrapRef, contentRef, signature, enabled }: Options) {
  const lastEl = useRef<HTMLElement | null>(null)
  const lastSignature = useRef<string>(signature)
  /** 上一次的目标宽度；为 null 表示尚未建立基线（下一帧就绪时直接落位）。 */
  const lastTarget = useRef<number | null>(null)
  const cleanupTimer = useRef<number | undefined>(undefined)

  // 无依赖数组：每次提交后运行，既能在签名变化时驱动过渡，也能在静止期校准基线。
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const content = contentRef.current
    if (!wrap || !content) {
      // 触发器未渲染（如「暂无可用模型」占位）：清空基线，下次真实挂载时重新建立。
      lastEl.current = null
      lastTarget.current = null
      return
    }

    // 未就绪：保持自然宽度、清空基线，确保「首次就绪」那一帧是落位而非动画。
    if (!enabled) {
      window.clearTimeout(cleanupTimer.current)
      wrap.style.transition = ''
      wrap.style.width = ''
      lastEl.current = wrap
      lastSignature.current = signature
      lastTarget.current = null
      return
    }

    const target = content.getBoundingClientRect().width

    // 元素重挂载或首次就绪：直接落位，仅建立基线。
    if (lastEl.current !== wrap || lastTarget.current === null) {
      window.clearTimeout(cleanupTimer.current)
      wrap.style.transition = ''
      wrap.style.width = ''
      lastEl.current = wrap
      lastSignature.current = signature
      lastTarget.current = target
      return
    }

    // 内容签名未变：非过渡锁定期时持续校准基线（吸收字体加载等非交互性重排，但不做动画）。
    if (signature === lastSignature.current) {
      if (!wrap.style.width) lastTarget.current = target
      return
    }
    lastSignature.current = signature

    const prevTarget = lastTarget.current
    lastTarget.current = target
    // 目标宽度未变（如等宽档位互切）：不打断可能在途的过渡，直接返回。
    if (Math.abs(target - prevTarget) < EPSILON_PX) return

    // 过渡起点：
    // - 静止时（未接管 width）此刻外层已随新内容重排到「新宽度」，故起点取上一次的基线宽度；
    // - 若上一段过渡仍在途（width 已被接管），取当前实际渲染宽度，从当前视觉宽度平滑续接。
    const start = wrap.style.width ? wrap.getBoundingClientRect().width : prevTarget
    if (
      Math.abs(start - target) < EPSILON_PX ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      window.clearTimeout(cleanupTimer.current)
      wrap.style.transition = ''
      wrap.style.width = ''
      return
    }

    // FLIP：从当前实际宽度钉起 → 强制回流 → 过渡到目标宽度 → 结束后交还布局。
    window.clearTimeout(cleanupTimer.current)
    wrap.style.transition = 'none'
    wrap.style.width = `${start}px`
    void wrap.offsetWidth
    wrap.style.transition = `width ${TRANSITION_MS}ms ${EASING}`
    wrap.style.width = `${target}px`
    cleanupTimer.current = window.setTimeout(() => {
      wrap.style.transition = ''
      wrap.style.width = ''
      lastTarget.current = content.getBoundingClientRect().width
    }, TRANSITION_MS + 30)
  })

  useEffect(() => () => window.clearTimeout(cleanupTimer.current), [])
}
