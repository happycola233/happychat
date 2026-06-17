import { FileText } from 'lucide-react'
import type { ContentPart } from '@shared/types/domain'
import { attachmentUrl } from '../api/attachments'

/** 渲染消息内容里的附件部件：图片缩略图、文件卡片、生成的图片。 */
export function AttachmentParts({ content }: { content: ContentPart[] }) {
  const parts = content.filter(
    (p) => p.type === 'input_image' || p.type === 'input_file' || p.type === 'image_result',
  )
  if (parts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {parts.map((p, i) => {
        if (p.type === 'input_image') {
          return (
            <a key={i} href={attachmentUrl(p.attachment_id)} target="_blank" rel="noreferrer">
              <img
                src={attachmentUrl(p.attachment_id)}
                alt="图片"
                className="max-h-44 max-w-[12rem] rounded-xl border border-neutral-200 object-cover dark:border-neutral-700"
              />
            </a>
          )
        }
        if (p.type === 'image_result') {
          return (
            <a key={i} href={attachmentUrl(p.attachment_id)} target="_blank" rel="noreferrer">
              <img
                src={attachmentUrl(p.attachment_id)}
                alt="生成的图片"
                title={p.revised_prompt}
                className="max-h-96 rounded-xl border border-neutral-200 dark:border-neutral-700"
              />
            </a>
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
