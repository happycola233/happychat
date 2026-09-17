import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, ImagePlus, Link2, Pencil, Trash2, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import {
  ANNOUNCEMENT_IMAGE_ACCEPT,
  ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH,
  MAX_ANNOUNCEMENT_IMAGE_BYTES,
  announcementImageMarkup,
  type AnnouncementImageLayout,
} from '@shared/schemas/announcement-image'
import { announcementBodyImages, type AnnouncementBodyImage } from '@shared/util/announcementImages'
import { safeHttpUrl } from '@shared/util/url'
import { uploadAnnouncementImage } from '../../api/announcements'
import { ApiRequestError } from '../../api/client'
import {
  AnnouncementArticle,
  type AnnouncementContent,
} from '../../announcements/AnnouncementArticle'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'
import { toast } from '../../store/toast'
import { AnnouncementImageDialog } from './AnnouncementImageDialog'

interface ImageDraft {
  image: AnnouncementImageLayout
  file?: File
  existing?: AnnouncementBodyImage
}

export function AnnouncementBodyEditor({
  body,
  onChange,
  preview,
  onBusyChange,
}: {
  body: string
  onChange: (body: string) => void
  preview: AnnouncementContent
  onBusyChange: (busy: boolean) => void
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const selection = useRef({ start: body.length, end: body.length })
  const objectUrls = useRef(new Set<string>())
  const [drafts, setDrafts] = useState<ImageDraft[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const images = useMemo(() => announcementBodyImages(body), [body])
  const draft = drafts[0]
  useEffect(() => {
    onBusyChange(uploading)
    return () => onBusyChange(false)
  }, [onBusyChange, uploading])
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  const addFiles = (files: File[]) => {
    const next: ImageDraft[] = []
    for (const file of files) {
      if (
        !ANNOUNCEMENT_IMAGE_ACCEPT.split(',').includes(file.type) &&
        !/\.(png|jpe?g|webp|gif)$/i.test(file.name)
      ) {
        toast.error('请选择 PNG、JPEG、WebP 或 GIF 图片')
        continue
      }
      if (!file.size || file.size > MAX_ANNOUNCEMENT_IMAGE_BYTES) {
        toast.error('每张图片不能超过 15 MB')
        continue
      }
      const src = URL.createObjectURL(file)
      objectUrls.current.add(src)
      next.push({ file, image: { src, alt: '', width: ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH } })
    }
    setDrafts(next)
  }
  const finishDraft = () => {
    if (draft?.file) {
      URL.revokeObjectURL(draft.image.src)
      objectUrls.current.delete(draft.image.src)
    }
    setDrafts((value) => value.slice(1))
  }
  const applyImage = async (layout: AnnouncementImageLayout) => {
    if (!draft) return
    const range = draft.existing ?? selection.current
    const before = body.slice(0, range.start)
    const after = body.slice(range.end)
    const prefix =
      draft.existing || !before || before.endsWith('\n\n')
        ? ''
        : before.endsWith('\n')
          ? '\n'
          : '\n\n'
    const suffix = draft.existing ? '' : '\n\n'
    // 上传期间冻结正文与关闭入口，防止异步结果覆盖新的文字或插入位置。
    setUploading(true)
    try {
      const source = draft.file ? (await uploadAnnouncementImage(draft.file)).url : layout.src
      const inserted = prefix + announcementImageMarkup({ ...layout, src: source }) + suffix
      const nextBody = before + inserted + after
      if (nextBody.length > 20000) {
        toast.error('正文不能超过 20,000 字，请删减后再插入图片')
        return
      }
      onChange(nextBody)
      const cursor = before.length + inserted.length
      selection.current = { start: cursor, end: cursor }
      finishDraft()
      if (drafts.length === 1)
        requestAnimationFrame(() => {
          textarea.current?.focus()
          textarea.current?.setSelectionRange(cursor, cursor)
        })
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : '图片上传失败，请检查网络后重试',
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor="announcement-body"
            className="mb-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
          >
            正文（Markdown）
          </label>
          <div
            className={clsx(
              'relative overflow-hidden rounded-xl border bg-white transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/15 dark:bg-neutral-900',
              dragging
                ? 'border-sky-500 ring-2 ring-sky-500/20'
                : 'border-neutral-300 dark:border-neutral-700',
            )}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('Files')) {
                event.preventDefault()
                setDragging(true)
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false)
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return
              event.preventDefault()
              setDragging(false)
              addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
              <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
                <ImagePlus className="h-4 w-4" />
                上传图片
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLink('')
                  setLinkOpen(true)
                }}
              >
                <Link2 className="h-4 w-4" />
                图片链接
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ANNOUNCEMENT_IMAGE_ACCEPT}
                className="hidden"
                aria-label="选择公告图片"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }}
              />
            </div>
            <textarea
              ref={textarea}
              id="announcement-body"
              value={body}
              maxLength={20000}
              disabled={uploading}
              onChange={(event) => {
                selection.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                }
                onChange(event.target.value)
              }}
              onSelect={(event) => {
                selection.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                  .flatMap((item) => {
                    const file = item.getAsFile()
                    return file ? [file] : []
                  })
                if (files.length) {
                  event.preventDefault()
                  selection.current = {
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  }
                  addFiles(files)
                }
              }}
              className="hc-scrollbar block h-72 min-h-52 w-full resize-y bg-transparent px-3.5 py-3 font-mono text-[13px] leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
              placeholder={'写下公告内容…\n\n支持 Markdown，也可以直接粘贴或拖入图片。'}
            />
            <div className="flex items-center justify-between gap-2 px-3.5 pb-2.5 text-[11px] text-neutral-400 dark:text-neutral-500">
              <span>粘贴或拖入图片 · 每张最多 15 MB</span>
              <span className="tabular-nums">{body.length.toLocaleString()} / 20,000</span>
            </div>
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sky-50/95 text-sm font-medium text-sky-700 dark:bg-sky-950/95 dark:text-sky-300">
                <Upload className="h-7 w-7" />
                松开以添加图片
              </div>
            )}
          </div>
          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2" aria-label="公告中的图片">
              {images.map((image, index) => (
                <div
                  key={`${image.start}:${image.src}`}
                  className="flex min-w-0 items-center gap-2 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-800/60"
                >
                  <button
                    type="button"
                    aria-label={`编辑图片 ${index + 1}`}
                    onClick={() => setDrafts([{ image, existing: image }])}
                    className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-neutral-700"
                  >
                    <img src={image.src} alt="" className="h-full w-full object-cover" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-neutral-700 dark:text-neutral-200">
                      {image.alt || `图片 ${index + 1}`}
                    </p>
                    <p className="mt-1 text-[10px] text-neutral-400">宽 {image.width} px</p>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDrafts([{ image, existing: image }])}
                        className="inline-flex min-h-6 items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400"
                      >
                        <Pencil className="h-3 w-3" />
                        编辑
                      </button>
                      <button
                        type="button"
                        aria-label={`移除图片 ${index + 1}`}
                        onClick={() => onChange(body.slice(0, image.start) + body.slice(image.end))}
                        className="inline-flex min-h-6 items-center gap-1 text-[11px] text-neutral-500 hover:text-red-500 dark:text-neutral-400"
                      >
                        <Trash2 className="h-3 w-3" />
                        移除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <span className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <Eye className="h-3.5 w-3.5" />
            实时预览
          </span>
          <div className="hc-scrollbar h-96 overflow-y-auto rounded-xl bg-neutral-50 px-5 py-6 dark:bg-neutral-950/50">
            {body.trim() ? (
              <AnnouncementArticle announcement={preview} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
                <Eye className="h-6 w-6 opacity-50" />
                <p className="text-sm">你的公告将在这里呈现</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {draft && (
        <AnnouncementImageDialog
          key={draft.image.src + ':' + draft.existing?.start}
          image={draft.image}
          editing={!!draft.existing}
          remaining={drafts.length}
          busy={uploading}
          onApply={(layout) => void applyImage(layout)}
          onClose={finishDraft}
        />
      )}
      {linkOpen && (
        <Modal
          open
          title="从链接添加图片"
          onClose={() => setLinkOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLinkOpen(false)}>
                取消
              </Button>
              <Button
                disabled={!safeHttpUrl(link)}
                onClick={() => {
                  setDrafts([
                    {
                      image: {
                        src: safeHttpUrl(link)!,
                        alt: '',
                        width: ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH,
                      },
                    },
                  ])
                  setLinkOpen(false)
                }}
              >
                调整图片
              </Button>
            </>
          }
        >
          <TextField
            label="图片链接"
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://example.com/image.png"
            hint="使用可直接打开图片的链接。"
          />
        </Modal>
      )}
    </>
  )
}
