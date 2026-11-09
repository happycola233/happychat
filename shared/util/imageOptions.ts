import type {
  ImageBackground,
  ImageComplexity,
  ImageModeration,
  ImageOptions,
  ImageOutputFormat,
  ImageQuality,
} from '../types/domain'

/**
 * OpenAI Images API（/images/generations 与 /images/edits）参数的单一来源：
 * 模型能力档案、可选值、「比例 × 清晰度 → 最终尺寸」、生效值解析与尺寸校验。
 * 前端参数面板、后台默认参数、请求体构建与服务端校验共用，避免三处规则漂移。
 *
 * 2026-11-10 核对：
 * - https://developers.openai.com/api/docs/guides/image-generation
 * - https://developers.openai.com/api/reference/resources/images/methods/generate
 * - https://developers.openai.com/api/reference/resources/images/methods/edit
 * GIF 每帧边长与总像素预算官方只说明「需落在模型尺寸与像素预算内」，这里的 960px 边长 /
 * 按帧数分格的整张预算参照 Runware 对 gpt-image-2.6 的公开说明（同一上游的封装）。
 */

export type ImageModelFamily = 'gpt-image-2.6' | 'gpt-image-2.5' | 'gpt-image-2' | 'standard'

export interface ImageModelProfile {
  family: ImageModelFamily
  /** true=接受任意 WIDTHxHEIGHT（16 的倍数、比例与像素受限）；false=只有三种标准尺寸。 */
  flexibleSize: boolean
  qualities: readonly ImageQuality[]
  /** gpt-image-2.6 起提供与画质独立的构思程度（complexity）。 */
  complexity: boolean
  /** gpt-image-2.6 起可输出动图 GIF（生成与编辑均可）。 */
  gif: boolean
  /** gpt-image-2.6 起可输出 SVG（仅文字生成；需账号开通 SVG 预览权限）。 */
  svg: boolean
}

const BASE_QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high']
const EXTENDED_QUALITIES: readonly ImageQuality[] = [...BASE_QUALITIES, 'xhigh', 'max']

/** 按模型 ID 推断能力；兼容供应商前缀（如 openai/gpt-image-2.6-flare）与快照后缀。 */
export function imageModelProfile(modelId: string): ImageModelProfile {
  const leaf = (modelId.split('/').pop() ?? modelId).trim().toLowerCase()
  if (leaf.startsWith('gpt-image-2.6'))
    return {
      family: 'gpt-image-2.6',
      flexibleSize: true,
      qualities: EXTENDED_QUALITIES,
      complexity: true,
      gif: true,
      svg: true,
    }
  if (leaf.startsWith('gpt-image-2.5'))
    return {
      family: 'gpt-image-2.5',
      flexibleSize: true,
      qualities: EXTENDED_QUALITIES,
      complexity: false,
      gif: false,
      svg: false,
    }
  if (leaf === 'gpt-image-2' || leaf.startsWith('gpt-image-2-'))
    return {
      family: 'gpt-image-2',
      flexibleSize: true,
      qualities: BASE_QUALITIES,
      complexity: false,
      gif: false,
      svg: false,
    }
  // gpt-image-1.x / chatgpt-image-latest 等：只承诺官方三种标准尺寸。
  return {
    family: 'standard',
    flexibleSize: false,
    qualities: BASE_QUALITIES,
    complexity: false,
    gif: false,
    svg: false,
  }
}

// —————————————————————— 可选值与界面文案 ——————————————————————

export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
}

export const IMAGE_COMPLEXITY_OPTIONS: readonly { value: ImageComplexity; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export const IMAGE_OUTPUT_FORMAT_LABELS: Record<ImageOutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  gif: 'GIF',
  svg: 'SVG',
}

export const IMAGE_BACKGROUND_LABELS: Record<ImageBackground, string> = {
  auto: '自动',
  opaque: '不透明',
  transparent: '透明',
}

export const IMAGE_MODERATION_LABELS: Record<ImageModeration, string> = {
  low: '宽松',
  auto: '标准',
}

export const IMAGE_COUNT_MAX = 4
export const IMAGE_PARTIAL_IMAGES_MAX = 3
export const GIF_FRAME_COUNT_MIN = 2
export const GIF_FRAME_COUNT_MAX = 16
export const GIF_FRAME_DURATION_MIN_MS = 20
/** 官方单帧上限远大于此；界面只提供实用范围，更长的停顿可用高级 JSON。 */
export const GIF_FRAME_DURATION_MAX_MS = 2000

/**
 * 本站内置默认：用户与管理员都未指定时使用。
 * 内容审核默认宽松（low）；过程预览默认 3 张，与 Responses 生图工具的渐进体验一致。
 */
export const IMAGE_BUILTIN_DEFAULTS = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: 100,
  background: 'auto',
  moderation: 'low',
  partial_images: IMAGE_PARTIAL_IMAGES_MAX,
  n: 1,
  frame_count: 9,
  frame_duration_ms: 200,
} as const

export function imageOutputFormats(profile: ImageModelProfile): ImageOutputFormat[] {
  return [
    'png',
    'jpeg',
    'webp',
    ...(profile.gif ? (['gif'] as const) : []),
    ...(profile.svg ? (['svg'] as const) : []),
  ]
}

/** SVG 只能由文字生成；带编辑源 / 参考图时走 /images/edits，不提供 SVG。 */
export function formatAvailable(format: ImageOutputFormat, editing: boolean): boolean {
  return !(editing && format === 'svg')
}

/** GIF / SVG 是单个动画或矢量文件：上游要求一次一张且不支持流式过程预览。 */
export function formatIsSingleFile(format: ImageOutputFormat): boolean {
  return format === 'gif' || format === 'svg'
}

/** 透明背景只能落在带 alpha 的 PNG / WebP 上。 */
export function formatSupportsTransparency(format: ImageOutputFormat): boolean {
  return format === 'png' || format === 'webp'
}

/** output_compression 只对 JPEG / WebP 生效。 */
export function formatSupportsCompression(format: ImageOutputFormat): boolean {
  return format === 'jpeg' || format === 'webp'
}

// —————————————————————— 尺寸：比例 × 清晰度 ——————————————————————

export interface ParsedImageSize {
  width: number
  height: number
  pixels: number
  normalizedSize: string
}

export function parseImageSize(size: string): ParsedImageSize | null {
  const match = size.trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null
  return { width, height, pixels: width * height, normalizedSize: `${width}x${height}` }
}

export function formatImageSizeLabel(size: string): string {
  if (size.trim() === 'auto') return '自动'
  const parsed = parseImageSize(size)
  return parsed ? `${parsed.width}×${parsed.height}` : size
}

export interface ImageAspectRatio {
  id: string
  width: number
  height: number
}

/** 横竖成对排列，界面按 5 列网格展示（另加「自动 / 自定义」）。 */
export const IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[] = [
  { id: '1:1', width: 1, height: 1 },
  { id: '4:3', width: 4, height: 3 },
  { id: '3:4', width: 3, height: 4 },
  { id: '3:2', width: 3, height: 2 },
  { id: '2:3', width: 2, height: 3 },
  { id: '16:9', width: 16, height: 9 },
  { id: '9:16', width: 9, height: 16 },
  { id: '21:9', width: 21, height: 9 },
]

/** 标准尺寸模型只有 1024x1024 / 1536x1024 / 1024x1536 三种。 */
const STANDARD_ASPECT_RATIO_IDS = new Set(['1:1', '3:2', '2:3'])

export type ImageResolutionId = '1k' | '2k' | '4k' | 'gif-standard' | 'gif-hd'

interface ImageResolution {
  id: ImageResolutionId
  label: string
  description: string
  /** 按短边定档（与官方标准尺寸对齐）；否则按像素预算定档。 */
  shortEdge?: number
  maxPixels?: number
  maxEdge: number
}

const STILL_MAX_EDGE = 3840
const STILL_MIN_PIXELS = 655_360
const STILL_MAX_PIXELS = 8_294_400
const STILL_MAX_ASPECT_RATIO = 3
/** 官方说明超过 2560x1440 的分辨率为实验性。 */
const STILL_STABLE_MAX_PIXELS = 2560 * 1440
const GIF_MAX_FRAME_EDGE = 960

const STILL_RESOLUTIONS: readonly ImageResolution[] = [
  {
    id: '1k',
    label: '1K',
    description: '短边 1024，出图最快',
    shortEdge: 1024,
    maxEdge: STILL_MAX_EDGE,
  },
  {
    id: '2k',
    label: '2K',
    description: '约 2560×1440 像素量',
    maxPixels: STILL_STABLE_MAX_PIXELS,
    maxEdge: STILL_MAX_EDGE,
  },
  {
    id: '4k',
    label: '4K',
    description: '约 3840×2160 像素量，实验性，耗时更长',
    maxPixels: STILL_MAX_PIXELS,
    maxEdge: STILL_MAX_EDGE,
  },
]

const GIF_RESOLUTIONS: readonly ImageResolution[] = [
  {
    id: 'gif-standard',
    label: '标准',
    description: '每帧约 512×512 像素量',
    maxPixels: 512 * 512,
    maxEdge: GIF_MAX_FRAME_EDGE,
  },
  {
    id: 'gif-hd',
    label: '高清',
    description: '每帧约 720×720 像素量',
    maxPixels: 720 * 720,
    maxEdge: GIF_MAX_FRAME_EDGE,
  },
]

const floor16 = (value: number) => Math.floor(value / 16) * 16
const round16 = (value: number) => Math.round(value / 16) * 16

function sizeFor(ratio: ImageAspectRatio, resolution: ImageResolution): string {
  const r = ratio.width / ratio.height
  if (resolution.shortEdge) {
    const longEdge = Math.min(
      resolution.maxEdge,
      round16(resolution.shortEdge * Math.max(r, 1 / r)),
    )
    return r >= 1 ? `${longEdge}x${resolution.shortEdge}` : `${resolution.shortEdge}x${longEdge}`
  }
  const maxPixels = resolution.maxPixels!
  // 先按像素预算求理想宽高，再受最长边约束；长边向下取整到 16 的倍数，短边按比例就近取整，
  // 超预算时短边退一档，保证结果既不越界又尽量贴近目标比例。
  const idealLong = Math.min(resolution.maxEdge, Math.sqrt(maxPixels * Math.max(r, 1 / r)))
  const longEdge = floor16(idealLong)
  let shortEdge = round16(longEdge / Math.max(r, 1 / r))
  if (longEdge * shortEdge > maxPixels) shortEdge -= 16
  return r >= 1 ? `${longEdge}x${shortEdge}` : `${shortEdge}x${longEdge}`
}

export interface ImageSizeChoice {
  /** 比例 id；'auto'=交给模型，'custom'=不属于任何预设组合的自定义尺寸。 */
  ratio: string
  resolution: ImageResolutionId | null
}

export interface ImageSizeOptions {
  ratios: readonly ImageAspectRatio[]
  resolutions: readonly { id: ImageResolutionId; label: string; description: string }[]
  customAllowed: boolean
}

/** 当前模型与输出格式下可选的比例、清晰度与是否允许自定义尺寸。 */
export function imageSizeOptions(profile: ImageModelProfile, gif: boolean): ImageSizeOptions {
  if (gif) return { ratios: IMAGE_ASPECT_RATIOS, resolutions: GIF_RESOLUTIONS, customAllowed: true }
  if (!profile.flexibleSize)
    return {
      ratios: IMAGE_ASPECT_RATIOS.filter((ratio) => STANDARD_ASPECT_RATIO_IDS.has(ratio.id)),
      resolutions: STILL_RESOLUTIONS.filter((resolution) => resolution.id === '1k'),
      customAllowed: false,
    }
  return { ratios: IMAGE_ASPECT_RATIOS, resolutions: STILL_RESOLUTIONS, customAllowed: true }
}

/** 由比例与清晰度推出上游支持的最终尺寸。 */
export function imageSizeForChoice(ratioId: string, resolutionId: ImageResolutionId): string {
  const ratio = IMAGE_ASPECT_RATIOS.find((item) => item.id === ratioId)
  const resolution = [...STILL_RESOLUTIONS, ...GIF_RESOLUTIONS].find(
    (item) => item.id === resolutionId,
  )
  if (!ratio || !resolution) return 'auto'
  return sizeFor(ratio, resolution)
}

/** 尺寸对应的预设组合（不区分模型），用于历史图片的生成详情；不是任何预设时返回 null。 */
export function imageSizePreset(
  size: string,
  gif: boolean,
): { ratio: string; resolution: string } | null {
  for (const ratio of IMAGE_ASPECT_RATIOS)
    for (const resolution of gif ? GIF_RESOLUTIONS : STILL_RESOLUTIONS)
      if (sizeFor(ratio, resolution) === size)
        return { ratio: ratio.id, resolution: resolution.label }
  return null
}

/** 反查尺寸属于哪个「比例 × 清晰度」组合；不是任何组合时视为自定义。 */
export function imageSizeChoice(
  size: string,
  profile: ImageModelProfile,
  gif: boolean,
): ImageSizeChoice {
  if (size === 'auto') return { ratio: 'auto', resolution: null }
  const options = imageSizeOptions(profile, gif)
  for (const ratio of options.ratios)
    for (const resolution of options.resolutions)
      if (imageSizeForChoice(ratio.id, resolution.id) === size)
        return { ratio: ratio.id, resolution: resolution.id }
  return { ratio: 'custom', resolution: null }
}

/** 与尺寸最接近的预设比例，用于切换清晰度或输出格式时保持画面朝向。 */
export function nearestAspectRatio(size: string, ratios = IMAGE_ASPECT_RATIOS): string | null {
  const parsed = parseImageSize(size)
  if (!parsed || parsed.height === 0) return null
  const target = Math.log(parsed.width / parsed.height)
  let best: ImageAspectRatio | null = null
  for (const ratio of ratios) {
    if (
      !best ||
      Math.abs(Math.log(ratio.width / ratio.height) - target) <
        Math.abs(Math.log(best.width / best.height) - target)
    )
      best = ratio
  }
  return best?.id ?? null
}

// —————————————————————— 尺寸校验 ——————————————————————

export type ImageSizeValidation =
  | { ok: true; normalizedSize: string }
  | { ok: false; message: string }

/** GIF 所有帧拼在一张画布上：帧数决定分格数，分格越多单帧越小。 */
function gifSheetCells(frameCount: number): number {
  if (frameCount <= 8) return 8
  if (frameCount === 9) return 9
  if (frameCount <= 12) return 12
  return 16
}

export function validateImageSize(
  size: string,
  profile: ImageModelProfile,
  gif: { frameCount: number } | null = null,
): ImageSizeValidation {
  if (size.trim() === 'auto') return { ok: true, normalizedSize: 'auto' }
  const parsed = parseImageSize(size)
  if (!parsed) return { ok: false, message: '分辨率格式应为 1024x1024' }
  const { width, height, pixels, normalizedSize } = parsed
  if (width <= 0 || height <= 0) return { ok: false, message: '分辨率必须大于 0' }
  if (!gif && !profile.flexibleSize) {
    return ['1024x1024', '1536x1024', '1024x1536'].includes(normalizedSize)
      ? { ok: true, normalizedSize }
      : { ok: false, message: '该模型只支持 1024×1024、1536×1024 与 1024×1536' }
  }
  if (width % 16 !== 0 || height % 16 !== 0) return { ok: false, message: '宽高都必须是 16 的倍数' }
  if (Math.max(width, height) / Math.min(width, height) > STILL_MAX_ASPECT_RATIO)
    return { ok: false, message: '长宽比例不能超过 3:1' }
  if (gif) {
    if (Math.max(width, height) > GIF_MAX_FRAME_EDGE)
      return { ok: false, message: `GIF 每帧边长不能超过 ${GIF_MAX_FRAME_EDGE}px` }
    if (pixels * gifSheetCells(gif.frameCount) > STILL_MAX_PIXELS)
      return { ok: false, message: '帧数与每帧尺寸超出上限，请减少帧数或缩小尺寸' }
    return { ok: true, normalizedSize }
  }
  if (Math.max(width, height) > STILL_MAX_EDGE)
    return { ok: false, message: `分辨率最大边不能超过 ${STILL_MAX_EDGE}px` }
  if (pixels < STILL_MIN_PIXELS) return { ok: false, message: '总像素不能低于 655,360' }
  if (pixels > STILL_MAX_PIXELS) return { ok: false, message: '总像素不能超过 8,294,400' }
  return { ok: true, normalizedSize }
}

// —————————————————————— 生效值解析 ——————————————————————

export interface ResolvedImageOptions {
  size: string
  quality: ImageQuality
  output_format: ImageOutputFormat
  /** 仅 JPEG / WebP 有值。 */
  output_compression: number | null
  background: ImageBackground
  moderation: ImageModeration
  /** 0 表示不流式；GIF / SVG 与多张时不提供过程预览，固定为 0。 */
  partial_images: number
  n: number
  /** null=不发送，由上游按模型默认（2.6 为 high）。 */
  complexity: ImageComplexity | null
  /** 仅 GIF 有值。 */
  frame_count: number | null
  frame_duration_ms: number | null
}

/**
 * 逐项按「用户选择 → 管理员默认 → 本站内置默认」取值，丢弃当前模型不支持的值，
 * 再按参数之间的依赖收敛（透明需 PNG/WebP、GIF 不支持流式与多张、尺寸需符合格式）。
 * 前端用它显示「本次实际会用」的值，服务端用它构建请求体，两端结果一致。
 */
export function resolveImageOptions(
  profile: ImageModelProfile,
  defaults: ImageOptions | null | undefined,
  overrides: ImageOptions | null | undefined,
  { editing }: { editing: boolean },
): ResolvedImageOptions {
  const pick = <K extends keyof ImageOptions>(
    key: K,
    supported: (value: NonNullable<ImageOptions[K]>) => boolean = () => true,
  ): NonNullable<ImageOptions[K]> | undefined => {
    for (const source of [overrides, defaults]) {
      const value = source?.[key]
      if (value !== undefined && value !== null && supported(value as NonNullable<ImageOptions[K]>))
        return value as NonNullable<ImageOptions[K]>
    }
    return undefined
  }

  const formats = imageOutputFormats(profile)
  const outputFormat =
    pick('output_format', (value) => formats.includes(value) && formatAvailable(value, editing)) ??
    IMAGE_BUILTIN_DEFAULTS.output_format
  const gif = outputFormat === 'gif'
  const singleFile = formatIsSingleFile(outputFormat)
  const frameCount = gif ? (pick('frame_count') ?? IMAGE_BUILTIN_DEFAULTS.frame_count) : null
  const n = singleFile ? 1 : (pick('n') ?? IMAGE_BUILTIN_DEFAULTS.n)
  const background =
    pick('background', (value) =>
      value === 'transparent' ? formatSupportsTransparency(outputFormat) : true,
    ) ?? IMAGE_BUILTIN_DEFAULTS.background

  return {
    size: resolveSize(pick('size') ?? IMAGE_BUILTIN_DEFAULTS.size, profile, frameCount),
    quality:
      pick('quality', (value) => profile.qualities.includes(value)) ??
      IMAGE_BUILTIN_DEFAULTS.quality,
    output_format: outputFormat,
    output_compression: formatSupportsCompression(outputFormat)
      ? (pick('output_compression') ?? IMAGE_BUILTIN_DEFAULTS.output_compression)
      : null,
    background,
    moderation: pick('moderation') ?? IMAGE_BUILTIN_DEFAULTS.moderation,
    partial_images:
      singleFile || n > 1 ? 0 : (pick('partial_images') ?? IMAGE_BUILTIN_DEFAULTS.partial_images),
    n,
    complexity: profile.complexity ? (pick('complexity') ?? null) : null,
    frame_count: frameCount,
    frame_duration_ms: gif
      ? (pick('frame_duration_ms') ?? IMAGE_BUILTIN_DEFAULTS.frame_duration_ms)
      : null,
  }
}

/**
 * 尺寸在当前格式下不成立时（例如静图的 2K 尺寸切到 GIF、或换到只支持标准尺寸的模型），
 * 保留画面比例换到该格式的默认清晰度，而不是让请求在上游失败。
 */
function resolveSize(size: string, profile: ImageModelProfile, frameCount: number | null): string {
  const gif = frameCount === null ? null : { frameCount }
  if (validateImageSize(size, profile, gif).ok) return parseImageSize(size)?.normalizedSize ?? size
  const options = imageSizeOptions(profile, gif !== null)
  const ratio = nearestAspectRatio(size, options.ratios)
  return ratio ? imageSizeForChoice(ratio, options.resolutions[0]!.id) : 'auto'
}
