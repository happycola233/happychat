export interface ParsedImageSize {
  width: number
  height: number
  pixels: number
  normalizedSize: string
}

export type ImageSizeValidation =
  | { ok: true; normalizedSize: string; parsed: ParsedImageSize | null }
  | { ok: false; message: string }

const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_EDGE = 3840
const GPT_IMAGE_2_MAX_ASPECT_RATIO = 3

export const GPT_IMAGE_2_SIZE_OPTIONS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x1152',
  '1152x2048',
  '2048x2048',
  '3840x2160',
  '2160x3840',
] as const

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

export function formatImageSizeLabel(size: string): string {
  if (size.trim() === 'auto') return '自动'

  const parsed = parseImageSize(size)
  if (!parsed) return size
  return `${parsed.width}×${parsed.height}`
}
