import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import { clsx } from 'clsx'
import { Plus, Square, X } from 'lucide-react'
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

/** 输入框正文最大高度（超出内部滚动）。 */
const TEXTAREA_MAX_HEIGHT_PX = 200
/** 镜像单行判定阈值：正文 line-height 24px，留 2px 容差。 */
const MIRROR_SINGLE_LINE_MAX_PX = 26
/** 网格列间距（两处 0.375rem），镜像测量可用宽度时要减去。 */
const GRID_COLUMN_GAPS_PX = 12
/** 行扩展动画的裁切标记摘除时机：略大于 CSS 过渡时长（0.2s），留一次重定向的余量。 */
const COMPOSER_EXPAND_SETTLE_MS = 280
/** 正文溢出时顶/底滚动渐隐的最大高度（约一行）：随滚动位置从 0 平滑增长到此值。 */
const COMPOSER_SCROLL_FADE_PX = 24

/** Composer 悬浮层的实时几何信息，供 ChatView 做滚动让位与 hero 居中。 */
export interface ComposerMetrics {
  /** 悬浮层整体高度：滚动区末尾内容让位用。 */
  height: number
  /** 输入框视觉盒中心到悬浮层底边的距离：hero 垂直居中与光晕锚点用。 */
  boxCenterFromBottom: number
}

interface Props {
  onSend: (text: string, attachments: AttachmentDTO[], imageSources: ImageEditSource[]) => void
  disabled?: boolean
  streaming?: boolean
  onStop?: () => void
  /** 聚合模型选择器，渲染在发送按钮左侧（移动端为 undefined，由顶栏承载）。 */
  modelControl?: ReactNode
  canImage?: boolean
  canFile?: boolean
  imageSources?: ImageEditSource[]
  scrollbarGutterWidth?: number
  onMetricsChange?: (metrics: ComposerMetrics) => void
  onRemoveImageSource?: (attachmentId: string) => void
  /** hero＝桌面端新对话居中态：隐藏免责声明与底部遮罩。 */
  variant?: 'docked' | 'hero'
  /**
   * 是否处于「hero→落底」的平移动画期间（仅新聊天发出首条消息时为 true）。
   * 免责声明/底部遮罩只在这段动画里做透明度过渡（延迟到输入框接近落位再淡入）；
   * 切换会话等瞬时落位场景直接显隐，避免旧状态在错误的位置闪一下。
   */
  dockAnimated?: boolean
}

/** 「+」聚合菜单：图片/文件上传入口收进一个按钮，上传中显示加载态。 */
function ComposerPlusMenu({
  canImage,
  canFile,
  uploading,
  onPickImage,
  onPickFile,
}: {
  canImage?: boolean
  canFile?: boolean
  uploading: boolean
  onPickImage: () => void
  onPickFile: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // 这里是 window 级监听，用 DOM 的 KeyboardEvent（顶部导入的是 React 合成事件类型）。
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="添加附件"
        title="添加附件"
        className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        {uploading ? (
          <Spinner className="h-4 w-4 text-neutral-400" />
        ) : (
          <Plus className={clsx('h-5 w-5 transition-transform duration-200', open && 'rotate-45')} />
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 origin-bottom">
          <div className="hc-pop-in w-40 rounded-2xl border border-neutral-200 bg-white p-1 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]">
            {canImage && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPickImage()
                }}
                className={itemClass}
              >
                <UploadImageIcon className="h-[18px] w-[18px]" />
                上传图片
              </button>
            )}
            {canFile && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPickFile()
                }}
                className={itemClass}
              >
                <AttachmentIcon className="h-[18px] w-[18px]" />
                上传文件
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Composer({
  onSend,
  disabled,
  streaming,
  onStop,
  modelControl,
  canImage,
  canFile,
  imageSources = [],
  scrollbarGutterWidth = 0,
  onMetricsChange,
  onRemoveImageSource,
  variant = 'docked',
  dockAnimated = false,
}: Props) {
  const sendOnEnter = useSettings((s) => s.preferences.sendOnEnter)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<AttachmentDTO[]>([])
  const [dragActive, setDragActive] = useState(false)
  // 多行态：正文超过单行宽度或有附件预览时，输入区独占首行、控件退到次行。
  const [multiline, setMultiline] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const expandRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const hasPreviews = imageSources.length > 0 || pending.length > 0
  const showPlusMenu = Boolean(canImage || canFile)

  const addPendingAttachment = useCallback((attachment: AttachmentDTO) => {
    setPending((items) => [...items, attachment])
  }, [])
  const { uploading, uploadFiles } = useAttachmentUpload({
    canImage,
    canFile,
    onUploaded: addPendingAttachment,
  })

  /**
   * 用隐藏镜像在「单行可用宽度」下试排版来决定单行/多行，
   * 而不是直接看当前 textarea 是否换行——否则切换布局后宽度变化会来回振荡。
   */
  const measureMultiline = useCallback(() => {
    if (hasPreviews) {
      setMultiline(true)
      return
    }
    if (!text) {
      setMultiline(false)
      return
    }
    // 显式换行必然多行。镜像是 pre-wrap 的 div，行尾换行符不会像 textarea 那样
    // 产生新行盒（scrollHeight 不变），只靠镜像会漏判「第二行是空行」的情形，
    // 表现为盒子已两行高但布局仍是单行、两侧控件被垂直居中。
    if (text.includes('\n')) {
      setMultiline(true)
      return
    }
    const mirror = mirrorRef.current
    const grid = gridRef.current
    if (!mirror || !grid) return
    const leadingWidth = leadingRef.current?.offsetWidth ?? 0
    const trailingWidth = trailingRef.current?.offsetWidth ?? 0
    const available = grid.clientWidth - leadingWidth - trailingWidth - GRID_COLUMN_GAPS_PX
    if (available <= 0) {
      setMultiline(true)
      return
    }
    mirror.style.width = `${available}px`
    mirror.textContent = text
    setMultiline(mirror.scrollHeight > MIRROR_SINGLE_LINE_MAX_PX)
  }, [hasPreviews, text])

  /**
   * 顶/底滚动渐隐：把「距顶 / 距底」的滚动量（各自封顶到 COMPOSER_SCROLL_FADE_PX）
   * 写进 CSS 变量，驱动 .hc-composer-primary 的 mask 渐变。
   * 滚到顶 → 顶部无渐隐；滚到底 → 底部无渐隐（光标行始终清晰）；未溢出 → 两端都不渐隐。
   */
  const updateScrollFade = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = COMPOSER_SCROLL_FADE_PX
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
    const top = Math.max(0, Math.min(el.scrollTop, max))
    const bottom = Math.max(0, Math.min(distanceFromBottom, max))
    el.style.setProperty('--hc-composer-fade-top', `${top}px`)
    el.style.setProperty('--hc-composer-fade-bottom', `${bottom}px`)
  }, [])

  useLayoutEffect(() => {
    measureMultiline()
  }, [measureMultiline])

  // 容器宽度变化（窗口缩放/侧栏开合）时重新判定单行宽度是否还装得下，并刷新渐隐（换行改变溢出）。
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const observer = new ResizeObserver(() => {
      measureMultiline()
      updateScrollFade()
    })
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measureMultiline, updateScrollFade])

  // 正文自增高：布局（单行/多行）确定后再量高，保证以最终宽度计算；量高后同步渐隐。
  // textarea 带 max-h-[200px]，height='auto' 不会真的撑大，故此刻读到的 scrollTop 仍是最终值。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
    updateScrollFade()
  }, [text, multiline, updateScrollFade])

  /**
   * 行扩展动画：网格内容（行数/布局）先瞬时排好版，外层容器高度再过渡到网格实测高度，
   * 于是任何“行数变化”（1⇄2、2⇄3……以及单行⇄多行布局切换）都表现为盒子高度的平滑生长。
   * 动画期间容器打开 overflow 裁切（内容贴底、顶部渐显）；静止时不裁切，避免影响「+」与模型菜单弹层。
   * 裁切标记用定时器摘除而非 transitionend——连续输入会不断重定向过渡（触发 transitioncancel），
   * 事件方案会在动画中途提前解除裁切。
   */
  useLayoutEffect(() => {
    const expand = expandRef.current
    const grid = gridRef.current
    if (!expand || !grid) return

    let settleTimer: number | null = null
    const syncHeight = () => {
      const next = `${grid.offsetHeight}px`
      if (expand.style.height === next) return
      expand.dataset.animating = 'true'
      expand.style.height = next
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = null
        delete expand.dataset.animating
      }, COMPOSER_EXPAND_SETTLE_MS)
    }

    // 首次直接落位（height 从 auto → px 不产生过渡，无闪动）。
    expand.style.height = `${grid.offsetHeight}px`
    const observer = new ResizeObserver(syncHeight)
    observer.observe(grid)
    return () => {
      observer.disconnect()
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [])

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
    const root = rootRef.current
    const box = boxRef.current
    if (!root || !box || !onMetricsChange) return

    const updateMetrics = () => {
      // Composer 是悬浮层；滚动区需要知道它的实时高度来给末尾内容让位。
      // 盒中心到底边的距离用于 hero 态把「输入框几何中心」压在视口中心（光晕同锚点）。
      const rootRect = root.getBoundingClientRect()
      const boxRect = box.getBoundingClientRect()
      onMetricsChange({
        height: Math.ceil(rootRect.height),
        boxCenterFromBottom: Math.round(rootRect.bottom - (boxRect.top + boxRect.height / 2)),
      })
    }

    updateMetrics()
    // 行扩展动画期间盒高逐帧变化，观察 box 才能让居中锚点全程跟手。
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(root)
    observer.observe(box)
    return () => observer.disconnect()
  }, [onMetricsChange])

  const docked = variant === 'docked'
  // 落底动画期间遮罩/免责声明的淡入：延迟到输入框滑到接近底部才开始，避免中途突兀出现。
  const dockChromeFadeClass = dockAnimated
    ? 'transition-opacity duration-500 delay-300 motion-reduce:transition-none'
    : undefined

  return (
    <div ref={rootRef} className="pointer-events-none relative pb-3 pt-2">
      {/* 底部遮罩：挡住滚动到输入框后面的内容；居中态没有内容经过，隐藏以免遮挡消息。 */}
      <div
        aria-hidden="true"
        className={clsx(
          'absolute bottom-0 left-0 top-8 bg-white dark:bg-[#000000]',
          dockChromeFadeClass,
          !docked && 'opacity-0',
        )}
        style={{ right: `${scrollbarGutterWidth}px` }}
      />
      <div
        className="relative px-4"
        style={{ paddingRight: `calc(1rem + ${scrollbarGutterWidth}px)` }}
      >
        {/* 视觉盒：浅色用低对比 hairline 描边 + 柔和弥散阴影撑起体积感，
            避免生硬的灰色描边压过居中态光晕；深色以描边为主要轮廓，维持原对比。 */}
        <div
          ref={boxRef}
          className={clsx(
            'pointer-events-auto relative mx-auto max-w-3xl rounded-[26px] border border-black/[0.07] bg-white px-2 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_18px_rgba(0,0,0,0.055)] transition focus-within:border-black/[0.11] focus-within:shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_24px_rgba(0,0,0,0.07)] dark:border-[#303030] dark:bg-[#212121] dark:shadow-none dark:focus-within:border-[#303030] dark:focus-within:shadow-none',
            dragActive &&
              'border-blue-300 bg-blue-50/40 shadow-[0_2px_18px_rgba(59,130,246,0.18)] dark:border-blue-600 dark:bg-blue-950/20',
          )}
        >
          {dragActive && (
            <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[22px] border border-dashed border-blue-300 bg-white/80 text-sm font-medium text-blue-600 backdrop-blur-sm dark:border-blue-600 dark:bg-neutral-900/80 dark:text-blue-300">
              松开以上传附件
            </div>
          )}
          {hasPreviews && (
            <div className="mb-2 space-y-2 px-1.5 pt-1">
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

          {/* 隐藏文件选择器常驻 DOM（拖拽/粘贴/E2E 依赖），入口聚合在「+」菜单里。 */}
          <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={onPick} />
          <input ref={fileInput} type="file" multiple hidden onChange={onPick} />

          {/* 行扩展动画容器：高度由 JS 跟随内层网格实测高度过渡（见上方 syncHeight）。 */}
          <div ref={expandRef} className="hc-composer-expand">
            <div
              ref={gridRef}
              className={clsx('hc-composer-grid', multiline && 'hc-composer-multiline')}
            >
              <div ref={leadingRef} className="hc-composer-leading flex items-center">
                {showPlusMenu && (
                  <ComposerPlusMenu
                    canImage={canImage}
                    canFile={canFile}
                    uploading={uploading}
                    onPickImage={() => imageInput.current?.click()}
                    onPickFile={() => fileInput.current?.click()}
                  />
                )}
              </div>

              <textarea
                ref={ref}
                rows={1}
                value={text}
                placeholder={imageSources.length > 0 ? '输入修改要求…' : '发送消息…'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={updateScrollFade}
                className="hc-composer-primary max-h-[200px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
              />

              <div ref={trailingRef} className="hc-composer-trailing flex items-center gap-1">
                {modelControl}
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

          {/* 镜像测量元素：按单行可用宽度试排版，判定是否需要切换多行布局。 */}
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 -z-10 whitespace-pre-wrap px-1.5 text-[15px] leading-6 [overflow-wrap:anywhere]"
          />
        </div>
        <p
          className={clsx(
            'mx-auto mt-2 max-w-3xl text-center text-xs text-neutral-400',
            dockChromeFadeClass,
            !docked && 'opacity-0',
          )}
        >
          模型可能会出错，请谨慎甄别重要信息。
        </p>
      </div>
    </div>
  )
}
