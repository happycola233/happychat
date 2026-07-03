import { FileText, Pencil } from 'lucide-react'
import type { ContentPart } from '@shared/types/domain'
import { attachmentUrl } from '../api/attachments'
import type { ImageEditSource } from './imageSource'
import { ImagePreviewTrigger } from './ImagePreview'

/** 渲染消息内容里的附件部件：图片缩略图、文件卡片、生成的图片。 */
export function AttachmentParts({
  content,
  onUseImageSource,
}: {
  content: ContentPart[]
  onUseImageSource?: (source: ImageEditSource) => void
}) {
  const parts = content.filter(
    (p) => p.type === 'input_image' || p.type === 'input_file' || p.type === 'image_result',
  )
  if (parts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
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
              {onUseImageSource && (
                <button
                  type="button"
                  onClick={() => onUseImageSource(source)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  title="以此图编辑"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  以此图编辑
                </button>
              )}
            </div>
          )
        }
        return (
          <a
            key={i}
            href={attachmentUrl(p.attachment_id)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="max-w-[12rem] truncate">{p.filename}</span>
          </a>
        )
      })}
    </div>
  )
}
