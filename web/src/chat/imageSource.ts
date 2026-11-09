import type { ContentPart } from '@shared/types/domain'

export interface ImageEditSource {
  attachmentId: string
  label: string
}

/** Images API 编辑只接受 PNG / JPEG / WebP；生成的 GIF 与 SVG 不能再作为编辑源。旧消息无 MIME 时视为位图。 */
const EDITABLE_GENERATED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function isEditableGeneratedImage(
  part: Extract<ContentPart, { type: 'image_result' }>,
): boolean {
  return !part.mime || EDITABLE_GENERATED_MIMES.has(part.mime)
}

/**
 * 当前分支最新回复恰好生成了一张可编辑图片时返回它，供输入框一键「基于上一张修改」。
 * 多张时由用户在图片下方自行挑选，避免替用户猜。
 */
export function latestGeneratedImageSource(
  messages: readonly { role: string; status: string; content: ContentPart[] }[],
): ImageEditSource | null {
  const last = messages.at(-1)
  if (last?.role !== 'assistant' || last.status !== 'complete') return null
  const images = last.content.filter(
    (part): part is Extract<ContentPart, { type: 'image_result' }> =>
      part.type === 'image_result' && isEditableGeneratedImage(part),
  )
  return images.length === 1 ? { attachmentId: images[0]!.attachment_id, label: '上一张' } : null
}
