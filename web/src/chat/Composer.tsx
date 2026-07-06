import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import { clsx } from 'clsx'
import { Square, X } from 'lucide-react'
import type { AttachmentDTO } from '@shared/types/api'
import { attachmentUrl } from '../api/attachments'
import { useSettings } from '../store/settings'
import { Spinner } from '../components/ui/Spinner'
import type { ImageEditSource } from './imageSource'
import { ArrowUpIcon, AttachmentIcon, UploadImageIcon } from './icons'
import { ImagePreviewTrigger } from './ImagePreview'
import { AttachmentDraftList } from './AttachmentDraftList'
import { attachmentDraftsFromAttachments } from './attachmentDraft'
import { useAttachmentUpload } from './useAttachmentUpload'

interface Props {
  onSend: (text: string, attachments: AttachmentDTO[], imageSources: ImageEditSource[]) => void
  disabled?: boolean
  streaming?: boolean
  onStop?: () => void
  leftControls?: ReactNode
  canImage?: boolean
  canFile?: boolean
  imageSources?: ImageEditSource[]
  scrollbarGutterWidth?: number
  onHeightChange?: (height: number) => void
  onRemoveImageSource?: (attachmentId: string) => void
}

export function Composer({
  onSend,
  disabled,
  streaming,
  onStop,
  leftControls,
  canImage,
  canFile,
  imageSources = [],
  scrollbarGutterWidth = 0,
  onHeightChange,
  onRemoveImageSource,
}: Props) {
  const sendOnEnter = useSettings((s) => s.preferences.sendOnEnter)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<AttachmentDTO[]>([])
  const [dragActive, setDragActive] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const addPendingAttachment = useCallback((attachment: AttachmentDTO) => {
    setPending((items) => [...items, attachment])
  }, [])
  const { uploading, uploadFiles } = useAttachmentUpload({
    canImage,
    canFile,
    onUploaded: addPendingAttachment,
  })

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    await uploadFiles(files)
  }

  const canSubmit = (text.trim().length > 0 || pending.length > 0) && !disabled && !uploading

  const submit = () => {
    if (!canSubmit) return
    onSend(text, pending, imageSources)
    setText('')
    setPending([])
    if (ref.current) ref.current.style.height = 'auto'
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (sendOnEnter) {
      // Enter 发送、Shift+Enter 换行
      if (!e.shiftKey) {
        e.preventDefault()
        submit()
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Enter 换行、Ctrl/⌘+Enter 发送
      e.preventDefault()
      submit()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void uploadFiles(files)
  }

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
    }

    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? [])
      dragDepth.current = 0
      setDragActive(false)
      void uploadFiles(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [uploadFiles])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || !onHeightChange) return

    const updateHeight = () => {
      // Composer 是悬浮层；滚动区需要知道它的实时高度来给末尾内容让位。
      onHeightChange(Math.ceil(el.getBoundingClientRect().height))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeightChange])

  return (
    <div ref={rootRef} className="pointer-events-none relative pb-3 pt-2">
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-8 bg-white dark:bg-[#000000]"
        style={{ right: `${scrollbarGutterWidth}px` }}
      />
      <div
        className="relative px-4"
        style={{ paddingRight: `calc(1rem + ${scrollbarGutterWidth}px)` }}
      >
        <div
          className={clsx(
            'pointer-events-auto relative mx-auto max-w-3xl rounded-[24px] border border-neutral-200 bg-white px-4 py-2.5 shadow-[0_1px_10px_rgba(0,0,0,0.07)] transition focus-within:border-neutral-300 focus-within:shadow-[0_2px_14px_rgba(0,0,0,0.09)] dark:border-[#303030] dark:bg-[#212121] dark:shadow-none dark:focus-within:border-[#303030] dark:focus-within:shadow-none',
            dragActive &&
              'border-blue-300 bg-blue-50/40 shadow-[0_2px_18px_rgba(59,130,246,0.18)] dark:border-blue-600 dark:bg-blue-950/20',
          )}
        >
          {dragActive && (
            <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[22px] border border-dashed border-blue-300 bg-white/80 text-sm font-medium text-blue-600 backdrop-blur-sm dark:border-blue-600 dark:bg-neutral-900/80 dark:text-blue-300">
              松开以上传附件
            </div>
          )}
          {(imageSources.length > 0 || pending.length > 0) && (
            <div className="mb-2 space-y-2">
              {imageSources.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {imageSources.map((source) => (
                    <div
                      key={source.attachmentId}
                      className="group relative flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 p-1 dark:border-violet-800 dark:bg-violet-950/30"
                    >
                      <ImagePreviewTrigger
                        src={attachmentUrl(source.attachmentId)}
                        alt="编辑源图片"
                        caption={`编辑源：${source.label}`}
                        className="h-10 w-10 overflow-hidden rounded"
                        imageClassName="block h-10 w-10 object-cover"
                      />
                      <span className="max-w-[8rem] truncate px-1 text-xs text-violet-700 dark:text-violet-200">
                        编辑源：{source.label}
                      </span>
                      <button
                        onClick={() => onRemoveImageSource?.(source.attachmentId)}
                        className="rounded p-0.5 text-violet-400 hover:text-red-500"
                        aria-label="移除编辑源"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <AttachmentDraftList
                items={attachmentDraftsFromAttachments(pending)}
                onRemove={(draftId) =>
                  setPending((items) => items.filter((item) => item.id !== draftId))
                }
                testId="pending-attachment"
              />
            </div>
          )}

          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={imageSources.length > 0 ? '输入修改要求…' : '发送消息…'}
            onChange={(e) => {
              setText(e.target.value)
              resize()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="max-h-[200px] min-h-9 w-full resize-none bg-transparent py-1.5 text-[15px] leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />

          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {(canImage || canFile) && (
                <div className="-ml-[5px] flex items-center gap-0.5">
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
                        onClick={() => imageInput.current?.click()}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
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
                        onClick={() => fileInput.current?.click()}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        title="上传文件"
                        aria-label="上传文件"
                      >
                        <AttachmentIcon className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
              )}
              {uploading && <Spinner className="h-4 w-4 text-neutral-400" />}
              {leftControls}
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2">
              {streaming ? (
                <button
                  onClick={onStop}
                  data-testid="stop-btn"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
                  aria-label="停止生成"
                  title="停止生成"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="hc-send-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:bg-neutral-200 disabled:text-white disabled:opacity-100 dark:disabled:bg-neutral-700"
                  aria-label="发送"
                >
                  <ArrowUpIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-neutral-400">
          模型可能会出错，请谨慎甄别重要信息。
        </p>
      </div>
    </div>
  )
}
