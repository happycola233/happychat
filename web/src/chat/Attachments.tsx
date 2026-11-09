import { clsx } from 'clsx'
import type { ContentPart } from '@shared/types/domain'
import { attachmentUrl } from '../api/attachments'
import { EditIcon } from './icons'
import { isEditableGeneratedImage, type ImageEditSource } from './imageSource'
import { ImagePreviewTrigger } from './ImagePreview'
import { FileAttachmentCard } from './FileAttachmentCard'
import { ImageGenerationInfo } from './ImageGenerationInfo'

/** 渲染消息内容里的附件部件：图片缩略图、文件卡片、生成的图片。 */
export function AttachmentParts({
  content,
  onUseImageSource,
  generationDurationMs = null,
  align = 'start',
}: {
  content: ContentPart[]
  onUseImageSource?: (source: ImageEditSource) => void
  /** 整次请求耗时：没有生成详情快照的旧单图消息用它显示用时。 */
  generationDurationMs?: number | null
  align?: 'start' | 'end'
}) {
  const parts = content.filter(
    (p) => p.type === 'input_image' || p.type === 'input_file' || p.type === 'image_result',
  )
  if (parts.length === 0) return null
  const singleGeneratedImage = parts.filter((p) => p.type === 'image_result').length === 1
  return (
    <div className={clsx('flex flex-wrap gap-2', align === 'end' && 'justify-end')}>
      {parts.map((p, i) => {
        if (p.type === 'input_image') {
          const url = attachmentUrl(p.attachment_id)
          return (
            <ImagePreviewTrigger
              key={i}
              src={url}
              alt="用户上传的图片"
              className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700"
              imageClassName="block max-h-44 max-w-[12rem] object-cover"
            />
          )
        }
        if (p.type === 'image_result') {
          const url = attachmentUrl(p.attachment_id)
          const source: ImageEditSource = {
            attachmentId: p.attachment_id,
            label: `生成图 ${i + 1}`,
          }
          return (
            <div key={i} className="flex flex-col items-start gap-1.5">
              <ImagePreviewTrigger
                src={url}
                alt="模型生成的图片"
                caption={p.revised_prompt}
                title={p.revised_prompt}
                className="hc-generated-image-frame"
                imageClassName="block max-h-[32rem] max-w-full rounded-xl"
              />
              <div className="flex flex-wrap items-center gap-1">
                {onUseImageSource && isEditableGeneratedImage(p) && (
                  <button
                    type="button"
                    onClick={() => onUseImageSource(source)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    title="以此图编辑"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    以此图编辑
                  </button>
                )}
                <ImageGenerationInfo
                  details={p.generation}
                  revisedPrompt={p.revised_prompt}
                  fallbackDurationMs={singleGeneratedImage ? generationDurationMs : null}
                />
              </div>
            </div>
          )
        }
        return (
          <FileAttachmentCard
            key={i}
            filename={p.filename}
            mime={p.mime ?? null}
            byteSize={p.byte_size ?? null}
            href={attachmentUrl(p.attachment_id)}
            data-testid="message-file-attachment"
          />
        )
      })}
    </div>
  )
}
