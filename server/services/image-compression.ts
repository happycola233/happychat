import { extname } from 'node:path'
import sharp from 'sharp'

interface ChatImageUpload {
  buffer: Buffer
  filename: string
  mime: string
}

// 高质量 WebP 保留原始像素尺寸；透明通道无损，smartSubsample 减少彩色边缘的失真。
const WEBP_QUALITY = 88
const WEBP_MAX_DIMENSION = 16_383
const MAX_CONCURRENT_COMPRESSIONS = 2
let availableSlots = MAX_CONCURRENT_COMPRESSIONS
const waitingUploads: (() => void)[] = []

/** Sharp 的 PNG 解码器不报告 APNG 帧数，需在 IDAT 前检查动画控制块，避免只留下首帧。 */
function isAnimatedPng(buffer: Buffer): boolean {
  for (let offset = 8; offset + 12 <= buffer.length; ) {
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    if (chunkType === 'acTL') return true
    if (chunkType === 'IDAT' || chunkType === 'IEND') return false
    offset += buffer.readUInt32BE(offset) + 12
  }
  return false
}

/**
 * 只在上传时压缩一次，后续上下文重放直接读取落盘结果。
 * 图片来自用户输入；无法处理、动图或压缩收益不足时保留原件，不让可选优化阻断上传。
 */
export async function compressChatImage(upload: ChatImageUpload): Promise<ChatImageUpload> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.mime)) return upload

  // 批量选图会并行发起上传，限制同时解码的图片数，避免多张高像素照片争抢内存。
  if (availableSlots > 0) availableSlots--
  else await new Promise<void>((resolve) => waitingUploads.push(resolve))
  try {
    const image = sharp(upload.buffer)
    const metadata = await image.metadata()
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1 ||
      (metadata.format === 'png' && isAnimatedPng(upload.buffer)) ||
      metadata.width > WEBP_MAX_DIMENSION ||
      metadata.height > WEBP_MAX_DIMENSION ||
      metadata.depth !== 'uchar'
    ) {
      return upload
    }

    const buffer = await image
      // 应用 EXIF 方向后移除元数据，手机竖拍不会横倒；不裁剪、不缩放。
      .autoOrient()
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100, smartSubsample: true, effort: 4 })
      .toBuffer()

    // 收益不足 5% 时保留原件，避免为极小的空间收益引入一次有损重编码。
    if (buffer.length >= upload.buffer.length * 0.95) return upload
    const extension = extname(upload.filename)
    const basename = extension ? upload.filename.slice(0, -extension.length) : upload.filename
    return { buffer, filename: `${basename}.webp`, mime: 'image/webp' }
  } catch {
    return upload
  } finally {
    const next = waitingUploads.shift()
    // 名额直接交给下一项，避免新上传插队导致并发超额。
    if (next) next()
    else availableSlots++
  }
}
