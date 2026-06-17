export interface ImageSizeOption {
  value: string
  label: string
  buttonLabel?: string
  experimental?: boolean
}

export interface ParsedImageSize {
  width: number
  height: number
  pixels: number
  normalizedSize: string
  experimental: boolean
}

export type ImageSizeValidation =
  | { ok: true; normalizedSize: string; parsed: ParsedImageSize | null }
  | { ok: false; message: string }

export const GPT_IMAGE_2_EXPERIMENTAL_PIXELS = 2560 * 1440

const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_EDGE = 3840
const GPT_IMAGE_2_MAX_ASPECT_RATIO = 3

export const GPT_IMAGE_2_SIZE_OPTIONS: ImageSizeOption[] = [
  { value: 'auto', label: '自动尺寸', buttonLabel: '自动尺寸' },
  { value: '1024x1024', label: '1024×1024 方' },
  { value: '1536x1024', label: '1536×1024 横' },
  { value: '1024x1536', label: '1024×1536 竖' },
  { value: '2048x1152', label: '2048×1152 2K 横' },
  { value: '1152x2048', label: '1152×2048 2K 竖' },
  {
    value: '2048x2048',
    label: '2048×2048 2K 方',
    buttonLabel: '2048×2048 2K 方 · 实验',
    experimental: true,
  },
  {
    value: '3840x2160',
    label: '3840×2160 4K 横',
    buttonLabel: '3840×2160 4K 横 · 实验',
    experimental: true,
  },
  {
    value: '2160x3840',
    label: '2160×3840 4K 竖',
    buttonLabel: '2160×3840 4K 竖 · 实验',
    experimental: true,
  },
]

export function shouldValidateGptImage2Size(modelId: string): boolean {
  const leafModelId = modelId.split('/').pop() ?? modelId
  return leafModelId === 'gpt-image-2' || leafModelId.startsWith('gpt-image-2-')
}

export function parseImageSize(size: string): ParsedImageSize | null {
  const match = size.trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null

  const pixels = width * height
  return {
    width,
    height,
    pixels,
    normalizedSize: `${width}x${height}`,
    experimental: pixels > GPT_IMAGE_2_EXPERIMENTAL_PIXELS,
  }
}

export function validateGptImage2Size(size: string): ImageSizeValidation {
  if (size.trim() === 'auto') return { ok: true, normalizedSize: 'auto', parsed: null }

  const parsed = parseImageSize(size)
  if (!parsed) return { ok: false, message: '分辨率格式应为 1024x1024' }

  const { width, height, pixels } = parsed
  if (width <= 0 || height <= 0) return { ok: false, message: '分辨率必须大于 0' }
  if (width > GPT_IMAGE_2_MAX_EDGE || height > GPT_IMAGE_2_MAX_EDGE) {
    return { ok: false, message: '分辨率最大边不能超过 3840px' }
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: '宽高都必须是 16 的倍数' }
  }
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  if (longEdge / shortEdge > GPT_IMAGE_2_MAX_ASPECT_RATIO) {
    return { ok: false, message: '长宽比例不能超过 3:1' }
  }
  if (pixels < GPT_IMAGE_2_MIN_PIXELS) {
    return { ok: false, message: '总像素不能低于 655,360' }
  }
  if (pixels > GPT_IMAGE_2_MAX_PIXELS) {
    return { ok: false, message: '总像素不能超过 8,294,400' }
  }

  return { ok: true, normalizedSize: parsed.normalizedSize, parsed }
}

export function formatImageSizeForButton(size: string): string {
  const option = GPT_IMAGE_2_SIZE_OPTIONS.find((item) => item.value === size)
  if (option) return option.buttonLabel ?? option.label

  const parsed = parseImageSize(size)
  if (!parsed) return size
  return `${parsed.width}×${parsed.height}`
}
