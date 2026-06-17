import { useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowUp, FileText, ImagePlus, Paperclip, Square, X } from 'lucide-react'
import type { AttachmentDTO } from '@shared/types/api'
import { attachmentUrl, uploadAttachment } from '../api/attachments'
import { toast } from '../store/toast'
import { Spinner } from '../components/ui/Spinner'

interface Props {
  onSend: (text: string, attachments: AttachmentDTO[]) => void
  disabled?: boolean
  streaming?: boolean
  onStop?: () => void
  leftControls?: ReactNode
  canImage?: boolean
  canFile?: boolean
}

export function Composer({
  onSend,
  disabled,
  streaming,
  onStop,
  leftControls,
  canImage,
  canFile,
}: Props) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<AttachmentDTO[]>([])
  const [uploading, setUploading] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) {
        const att = await uploadAttachment(f)
        setPending((p) => [...p, att])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const canSubmit = (text.trim().length > 0 || pending.length > 0) && !disabled && !uploading

  const submit = () => {
    if (!canSubmit) return
    onSend(text, pending)
    setText('')
    setPending([])
    if (ref.current) ref.current.style.height = 'auto'
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-300 bg-white px-3 py-2 transition focus-within:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((a) => (
              <div
                key={a.id}
                className="group relative flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-900"
              >
                {a.kind === 'image' ? (
                  <img src={attachmentUrl(a.id)} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <span className="flex items-center gap-1.5 px-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    <FileText className="h-4 w-4" />
                    <span className="max-w-[8rem] truncate">{a.filename}</span>
                  </span>
                )}
                <button
                  onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
                  className="rounded p-0.5 text-neutral-400 hover:text-red-500"
                  aria-label="移除附件"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="发送消息…"
          onChange={(e) => {
            setText(e.target.value)
            resize()
          }}
          onKeyDown={onKeyDown}
          className="max-h-[200px] w-full resize-none bg-transparent py-1 text-[15px] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
        />

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
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
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700"
                  title="上传图片"
                  aria-label="上传图片"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
              </>
            )}
            {canFile && (
              <>
                <input ref={fileInput} type="file" multiple hidden onChange={onPick} />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700"
                  title="上传文件"
                  aria-label="上传文件"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </>
            )}
            {uploading && <Spinner className="h-4 w-4 text-neutral-400" />}
            {leftControls}
          </div>
          {streaming ? (
            <button
              onClick={onStop}
              data-testid="stop-btn"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-800 disabled:opacity-30 dark:bg-white dark:text-neutral-900"
              aria-label="发送"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-neutral-400">
        模型可能会出错，请谨慎甄别重要信息。
      </p>
    </div>
  )
}
