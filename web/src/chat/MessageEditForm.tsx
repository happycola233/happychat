import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import { clsx } from 'clsx'
import { AttachmentDraftList } from './AttachmentDraftList'
import {
  attachmentDraftsFromAttachments,
  canSubmitAttachmentDraft,
  removeAttachmentDraft,
  type AttachmentDraftItem,
} from './attachmentDraft'
import { AttachmentIcon, UploadImageIcon } from './icons'
import {
  getUserMessageEditVisibleHeight,
  USER_MESSAGE_EDIT_TEXT_CLASS,
  USER_MESSAGE_EDIT_MIN_HEIGHT,
} from './messageStyles'
import { completedUploadAttachments } from './uploadDraft'
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 长提示词编辑时给出接近 ChatGPT 的大视窗，超出后只滚动正文区域。
    const maxHeight = getUserMessageEditVisibleHeight(window.innerHeight)
    el.style.height = 'auto'
    const nextHeight = Math.min(Math.max(el.scrollHeight, USER_MESSAGE_EDIT_MIN_HEIGHT), maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  // 新上传的附件选中即上屏（uploads 三态），提交时把完成项并入既有草稿。
  const { uploads, uploadFiles, removeUpload, retryUpload, uploading, hasFailed } =
    useAttachmentUpload({ canImage, canFile })
  const uploadedDrafts = attachmentDraftsFromAttachments(completedUploadAttachments(uploads))

  const canSubmit =
    canSubmitAttachmentDraft(draft, [...attachments, ...uploadedDrafts]) &&
    !uploading &&
    !hasFailed

  useLayoutEffect(() => {
    resizeTextarea()
  }, [attachments.length, uploads.length, draft, resizeTextarea])

  useLayoutEffect(() => {
    window.addEventListener('resize', resizeTextarea)
    return () => window.removeEventListener('resize', resizeTextarea)
  }, [resizeTextarea])

  const submitEdit = () => {
    if (!canSubmit) return
    const accepted = onSubmit({ text: draft.trim(), attachments: [...attachments, ...uploadedDrafts] })
    if (accepted !== false) onCancel()
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    uploadFiles(files)
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    uploadFiles(files)
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
    uploadFiles(files)
  }

  return (
    <div className="flex justify-end">
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={clsx(
          'hc-message-edit-area relative w-full max-w-[85%] rounded-3xl px-4 py-3.5',
          dragActive && 'ring-1 ring-blue-300 dark:ring-blue-700',
        )}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[20px] border border-dashed border-blue-300 bg-white/80 text-sm font-medium text-blue-600 backdrop-blur-sm dark:border-blue-600 dark:bg-neutral-900/80 dark:text-blue-300">
            松开以上传附件
          </div>
        )}
        <AttachmentDraftList
          items={attachments}
          uploads={uploads}
          onRemove={(draftId) =>
            setAttachments((items) => removeAttachmentDraft(items, draftId))
          }
          onRemoveUpload={removeUpload}
          onRetryUpload={retryUpload}
          className="mb-2"
          testId="edit-attachment-chip"
        />
        <textarea
          ref={textareaRef}
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
          rows={1}
          className={`${USER_MESSAGE_EDIT_TEXT_CLASS} hc-scrollbar w-full resize-none overflow-hidden bg-transparent outline-none`}
          style={{ minHeight: USER_MESSAGE_EDIT_MIN_HEIGHT }}
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
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="edit-submit"
              onClick={submitEdit}
              disabled={!canSubmit}
              className="hc-send-button rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-white dark:disabled:bg-neutral-600 dark:disabled:text-neutral-300"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
