/**
 * 思考状态点阵（3×3）的纯模拟：只推进数值，不接触 DOM，绘制交给 ThinkingGlyph。
 *
 * - waiting：发送后等待上游，点阵收拢呼吸，亮点沿外圈巡游；
 * - thinking：点随机「放电」并向上下左右传导，频率与幅度随 energy 变化；
 *   energy 由真实到达的过程文字推高、随后自然回落，所以吐字越快越活跃，卡住时归于平静；
 * - settling：开始回答，点阵向中心收拢并淡出，结束后停帧。
 */

export type ThinkingGlyphPhase = 'waiting' | 'thinking' | 'settling'

interface ThinkingGlyphDot {
  readonly homeX: number
  readonly homeY: number
  readonly wobblePhase: number
  /** 行号 + 列号：底波沿左上 → 右下的对角线推进。 */
  readonly diagonal: number
  /** 0–1，放电亮度；绘制时与底波叠加后映射为不透明度与半径。 */
  brightness: number
}

export interface ThinkingGlyphField {
  elapsedSeconds: number
  readonly dots: ThinkingGlyphDot[]
  /** 点阵相对中心的缩放：等待态收拢，思考态舒展，收束时归零。 */
  scale: number
  opacity: number
  energy: number
  /** 涟漪起点（elapsedSeconds）；按中心 → 四边 → 四角分拨点亮。 */
  rippleStartedAt: number | null
  rippleWavesFired: number
}

export interface ThinkingGlyphDotSample {
  x: number
  y: number
  radius: number
  opacity: number
}

/** 绘制坐标系边长；组件按实际像素等比缩放。 */
export const THINKING_GLYPH_VIEWBOX = 18

const CENTER = THINKING_GLYPH_VIEWBOX / 2
const GRID_SPACING = 5.4
const TAU = Math.PI * 2
/** 外圈八点的顺时针顺序，等待态的亮点沿此巡游。 */
const RING_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const RIPPLE_WAVE_OF_DOT = [2, 1, 2, 1, 0, 1, 2, 1, 2]
const RIPPLE_WAVE_GAP_SECONDS = 0.08
const RIPPLE_WAVE_COUNT = 3
const BASELINE_ENERGY = 0.3
const MAX_ENERGY = 1.6
/** 与等待态呼吸的中值接近，等待 → 思考换组件挂载时不跳变。 */
const INITIAL_SCALE = 0.78
const MIN_DOT_OPACITY = 0.22

function neighborsOf(index: number): number[] {
  const row = Math.floor(index / 3)
  const column = index % 3
  const neighbors: number[] = []
  if (row > 0) neighbors.push(index - 3)
  if (row < 2) neighbors.push(index + 3)
  if (column > 0) neighbors.push(index - 1)
  if (column < 2) neighbors.push(index + 1)
  return neighbors
}

function ignite(dot: ThinkingGlyphDot, brightness: number) {
  dot.brightness = Math.max(dot.brightness, brightness)
}

/** 帧率无关的指数趋近：rate 越大越快贴近目标。 */
function approach(current: number, target: number, rate: number, secondsDelta: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * secondsDelta))
}

export function createThinkingGlyphField(random: () => number = Math.random): ThinkingGlyphField {
  return {
    elapsedSeconds: 0,
    dots: Array.from({ length: 9 }, (_, index) => ({
      homeX: ((index % 3) - 1) * GRID_SPACING,
      homeY: (Math.floor(index / 3) - 1) * GRID_SPACING,
      wobblePhase: random() * TAU,
      diagonal: Math.floor(index / 3) + (index % 3),
      brightness: 0,
    })),
    scale: INITIAL_SCALE,
    opacity: 1,
    energy: BASELINE_ENERGY,
    rippleStartedAt: null,
    rippleWavesFired: 0,
  }
}

/** 新的过程文字到达：按字数推高活跃度，单次增量有上限，避免整段回放时瞬间顶满。 */
export function exciteThinkingGlyph(field: ThinkingGlyphField, arrivedChars: number): void {
  if (arrivedChars <= 0) return
  field.energy = Math.min(MAX_ENERGY, field.energy + Math.min(0.5, 0.06 + arrivedChars * 0.004))
}

/** 新小标题到达：从中心向外荡开一圈。 */
export function rippleThinkingGlyph(field: ThinkingGlyphField): void {
  field.rippleStartedAt = field.elapsedSeconds
  field.rippleWavesFired = 0
  field.energy = Math.min(MAX_ENERGY, field.energy + 0.5)
}

export function advanceThinkingGlyphField(
  field: ThinkingGlyphField,
  phase: ThinkingGlyphPhase,
  secondsDelta: number,
  random: () => number = Math.random,
): void {
  field.elapsedSeconds += secondsDelta
  const time = field.elapsedSeconds
  const { dots } = field

  if (phase === 'waiting') {
    field.scale = 0.68 + 0.2 * (0.5 + 0.5 * Math.sin(time * 3.2))
    RING_ORDER.forEach((index, order) => {
      const lag = (((time * 9 - order) % 8) + 8) % 8
      dots[index]!.brightness = Math.exp(-lag * 0.7)
    })
    dots[4]!.brightness = 0.25
    field.opacity = approach(field.opacity, 1, 10, secondsDelta)
    return
  }

  for (const dot of dots) dot.brightness *= Math.exp(-secondsDelta * 3.4)

  if (phase === 'settling') {
    field.scale = approach(field.scale, 0, 9, secondsDelta)
    field.opacity = approach(field.opacity, 0, 7, secondsDelta)
    return
  }

  field.scale = approach(field.scale, 1, 8, secondsDelta)
  field.opacity = approach(field.opacity, 1, 10, secondsDelta)
  field.energy = approach(field.energy, BASELINE_ENERGY, 1.1, secondsDelta)

  if (random() < secondsDelta * (2.4 + field.energy * 9)) {
    const index = Math.floor(random() * dots.length)
    ignite(dots[index]!, 0.55 + 0.45 * random())
    if (random() < 0.55) {
      for (const neighbor of neighborsOf(index)) ignite(dots[neighbor]!, 0.3 + 0.2 * field.energy)
    }
  }

  if (field.rippleStartedAt !== null) {
    const rippleElapsed = time - field.rippleStartedAt
    while (
      field.rippleWavesFired < RIPPLE_WAVE_COUNT &&
      rippleElapsed >= field.rippleWavesFired * RIPPLE_WAVE_GAP_SECONDS
    ) {
      const wave = field.rippleWavesFired
      dots.forEach((dot, index) => {
        if (RIPPLE_WAVE_OF_DOT[index] === wave) ignite(dot, 1 - wave * 0.15)
      })
      field.rippleWavesFired += 1
    }
    if (field.rippleWavesFired >= RIPPLE_WAVE_COUNT) field.rippleStartedAt = null
  }
}

/** 收束动画已淡到不可见，可以停帧。 */
export function isThinkingGlyphSettled(field: ThinkingGlyphField): boolean {
  return field.opacity < 0.01
}

export function sampleThinkingGlyphDots(
  field: ThinkingGlyphField,
  phase: ThinkingGlyphPhase,
): ThinkingGlyphDotSample[] {
  // 思考时点位随活跃度轻微游移，像在「呼吸」；其余阶段保持网格整齐。
  const wobble = phase === 'thinking' ? 0.5 * field.energy : 0
  const time = field.elapsedSeconds
  return field.dots.map((dot) => {
    // 对角底波：模型静默推理、没有文字到达时点阵也在持续流动，放电叠加其上。
    const ambient =
      phase === 'waiting' ? 0 : 0.32 * (0.5 + 0.5 * Math.sin(time * 2.4 - dot.diagonal * 0.85))
    const brightness = Math.min(1, dot.brightness + ambient * (1 - dot.brightness))
    return {
      x: CENTER + dot.homeX * field.scale + Math.sin(time * 1.9 + dot.wobblePhase) * wobble,
      y: CENTER + dot.homeY * field.scale + Math.cos(time * 1.6 + dot.wobblePhase * 1.3) * wobble,
      radius: 0.95 + 0.8 * brightness,
      opacity: (MIN_DOT_OPACITY + (1 - MIN_DOT_OPACITY) * brightness) * field.opacity,
    }
  })
}

/** 减少动态效果时的静态帧：整齐网格、统一中等亮度。 */
export function staticThinkingGlyphDots(): ThinkingGlyphDotSample[] {
  return Array.from({ length: 9 }, (_, index) => ({
    x: CENTER + ((index % 3) - 1) * GRID_SPACING,
    y: CENTER + (Math.floor(index / 3) - 1) * GRID_SPACING,
    radius: 1.2,
    opacity: 0.55,
  }))
}
