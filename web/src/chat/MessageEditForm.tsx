import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import { clsx } from 'clsx'
import { Spinner } from '../components/ui/Spinner'
import type { AttachmentDTO } from '@shared/types/api'
import { AttachmentDraftList } from './AttachmentDraftList'
import {
  attachmentDraftFromAttachment,
  canSubmitAttachmentDraft,
  removeAttachmentDraft,
  type AttachmentDraftItem,
} from './attachmentDraft'
import { AttachmentIcon, UploadImageIcon } from './icons'
import { MESSAGE_BODY_TEXT_CLASS } from './messageStyles'
import { useAttachmentUpload } from './useAttachmentUpload'

export interface MessageEditSubmit {
  text: string
  attachments: AttachmentDraftItem[]
}

interface MessageEditFormProps {
  initialText: string
  initialAttachments: AttachmentDraftItem[]
  canImage?: boolean
  canFile?: boolean
  onCancel: () => void
  onSubmit: (input: MessageEditSubmit) => boolean | void
}

export function MessageEditForm({
  initialText,
  initialAttachments,
  canImage,
  canFile,
  onCancel,
  onSubmit,
}: MessageEditFormProps) {
  const [draft, setDraft] = useState(initialText)
  const [attachments, setAttachments] = useState(initialAttachments)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const addAttachment = useCallback((attachment: AttachmentDTO) => {
    setAttachments((items) => [...items, attachmentDraftFromAttachment(attachment)])
  }, [])
  const { uploading, uploadFiles } = useAttachmentUpload({
    canImage,
    canFile,
    onUploaded: addAttachment,
  })

  const canSubmit = canSubmitAttachmentDraft(draft, attachments) && !uploading

  const submitEdit = () => {
    if (!canSubmit) return
    const accepted = onSubmit({ text: draft.trim(), attachments })
    if (accepted !== false) onCancel()
  }

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    await uploadFiles(files)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void uploadFiles(files)
  }

  const hasFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files')

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    setDragActive(true)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer.files)
    dragDepth.current = 0
    setDragActive(false)
    void uploadFiles(files)
  }

  return (
    <div className="flex justify-end">
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={clsx(
          'relative w-full max-w-[85%] rounded-3xl bg-neutral-100 px-4 py-3.5 dark:bg-neutral-800',
          dragActive &&
            'bg-blue-50/70 ring-1 ring-blue-300 dark:bg-blue-950/20 dark:ring-blue-700',
        )}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[20px] border border-dashed border-blue-300 bg-white/80 text-sm font-medium text-blue-600 backdrop-blur-sm dark:border-blue-600 dark:bg-neutral-900/80 dark:text-blue-300">
            松开以上传附件
          </div>
        )}
        <AttachmentDraftList
          items={attachments}
          onRemove={(draftId) =>
            setAttachments((items) => removeAttachmentDraft(items, draftId))
          }
          className="mb-2"
          testId="edit-attachment-chip"
        />
        <textarea
          autoFocus
          data-testid="edit-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submitEdit()
            }
          }}
          className={`${MESSAGE_BODY_TEXT_CLASS} min-h-[4.5rem] w-full resize-none bg-transparent outline-none`}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="-ml-1 flex items-center gap-1">
            {canImage && (
              <>
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={onPick}
                />
                <button
                  type="button"
                  data-testid="edit-upload-image"
                  onClick={() => imageInput.current?.click()}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  title="上传图片"
                  aria-label="上传图片"
                >
                  <UploadImageIcon className="h-5 w-5" />
                </button>
              </>
            )}
            {canFile && (
              <>
                <input ref={fileInput} type="file" multiple hidden onChange={onPick} />
                <button
                  type="button"
                  data-testid="edit-upload-file"
                  onClick={() => fileInput.current?.click()}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-600 transition hover:bg-white/70 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  title="上传文件"
                  aria-label="上传文件"
                >
                  <AttachmentIcon className="h-5 w-5" />
                </button>
              </>
            )}
            {uploading && <Spinner className="h-4 w-4 text-neutral-400" />}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="edit-submit"
              onClick={submitEdit}
              disabled={!canSubmit}
              className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:disabled:bg-neutral-600 dark:disabled:text-neutral-300"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
