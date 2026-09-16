interface ImageGenerationGlow {
  readonly phase: number
  readonly secondaryPhase: number
  readonly frequency: number
  readonly baseRadius: number
  readonly baseHue: number
  x: number
  y: number
  inverseRadiusSquared: number
  strength: number
  hue: number
}

export interface ImageGenerationField {
  elapsedSeconds: number
  readonly glows: ImageGenerationGlow[]
}

export interface ImageGenerationDotSample {
  radius: number
  opacity: number
  color: string
}

const TAU = Math.PI * 2
const GLOW_HUES = [211, 252]

export function createImageGenerationField(
  random: () => number = Math.random,
): ImageGenerationField {
  const field: ImageGenerationField = {
    elapsedSeconds: 0,
    glows: GLOW_HUES.map((baseHue, index) => ({
      phase: TAU * (index / GLOW_HUES.length + random() * 0.16),
      secondaryPhase: random() * TAU,
      frequency: 0.42 + random() * 0.16,
      baseRadius: 0.3 + random() * 0.07,
      baseHue,
      x: 0,
      y: 0,
      inverseRadiusSquared: 0,
      strength: 0,
      hue: baseHue,
    })),
  }
  // 初始化就计算完整场，减少动态效果时绘制的第一帧也有层次。
  advanceImageGenerationField(field, 0)
  return field
}

export function advanceImageGenerationField(
  field: ImageGenerationField,
  secondsDelta: number,
): void {
  field.elapsedSeconds += secondsDelta
  for (const glow of field.glows) {
    const orbit = field.elapsedSeconds * glow.frequency
    const secondaryOrbit = orbit * 0.57 + glow.secondaryPhase
    // 叠加互不整除的缓慢周期，让光团自然游走，避免单向扫描或同步折返。
    glow.x = 0.5 + 0.28 * Math.sin(orbit + glow.phase) + 0.12 * Math.sin(secondaryOrbit)
    glow.y =
      0.5 +
      0.28 * Math.cos(orbit * 0.83 + glow.phase) +
      0.12 * Math.sin(secondaryOrbit * 0.71 + glow.phase)
    const radius = glow.baseRadius * (1 + 0.12 * Math.sin(orbit * 0.61 + glow.secondaryPhase))
    glow.inverseRadiusSquared = 1 / (radius * radius)
    glow.strength = 0.78 + 0.22 * Math.sin(orbit * 0.73 + glow.phase)
    glow.hue = glow.baseHue + 12 * Math.sin(orbit * 0.29 + glow.secondaryPhase)
  }
}

/** x / y 为 0..1 归一坐标；只采样连续场，绘制帧不会重新抽取随机点。 */
export function sampleImageGenerationDot(
  field: ImageGenerationField,
  x: number,
  y: number,
  dark: boolean,
): ImageGenerationDotSample {
  let energy = 0
  let intensity = 0
  let weightedHue = 0
  for (const glow of field.glows) {
    // 矩形舞台保持固定网格；校正 4:3 比例，让内部每片亮区呈圆润轮廓。
    const distanceX = (x - glow.x) * (4 / 3)
    const distanceY = y - glow.y
    const weight =
      Math.exp(-(distanceX * distanceX + distanceY * distanceY) * glow.inverseRadiusSquared) *
      glow.strength
    energy += weight
    // 亮度不叠加，避免交汇处堆出突兀的亮块；色彩仍在相邻亮区间连续混合。
    intensity = Math.max(intensity, weight)
    weightedHue += glow.hue * weight
  }

  const saturation = Math.round(10 + 62 * intensity)
  return {
    radius: 0.64 + 2.03 * intensity,
    opacity: (dark ? 0.18 : 0.16) + (dark ? 0.62 : 0.57) * intensity,
    color: `hsl(${(weightedHue / energy).toFixed(2)} ${saturation}% ${dark ? 73 : 51}%)`,
  }
}
