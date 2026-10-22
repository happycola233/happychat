import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { clsx } from 'clsx'
import {
  AlertCircle,
  Check,
  Code2,
  Download,
  Maximize2,
  Play,
  RotateCcw,
  Shapes,
  WandSparkles,
} from 'lucide-react'
import { artifactTitle } from '@shared/util/artifactBlocks'
import {
  ARTIFACT_MAX_FRAME_HEIGHT,
  buildArtifactDocument,
  collectArtifactAssets,
} from '@shared/util/artifactDocument'
import type { ArtifactFrameMessage, ArtifactTheme } from '@shared/util/artifactDocument'
import type { ArtifactAssetId } from '@shared/util/artifactLibraries'
import { saveBlobToFile } from '../api/export'
import { Modal } from '../components/ui/Modal'
import { copyToClipboard } from '../lib/clipboard'
import { useSettings } from '../store/settings'
import { toast } from '../store/toast'
import { CopyIcon } from './icons'
import { loadArtifactAssets } from './artifactAssets'
import { ArtifactActionsContext, buildArtifactFixPrompt } from './artifactActions'
import { useArtifactTheme } from './useArtifactTheme'

/**
 * 安全边界：只允许脚本，绝不加 allow-same-origin。srcdoc 文档因此是不透明源，
 * 读不到站点的 DOM、cookie 与存储，也无法以用户身份调用接口（单测守护这一取值）。
 */
export const ARTIFACT_FRAME_SANDBOX = 'allow-scripts'

const MIN_FRAME_HEIGHT = 48
const PLACEHOLDER_HEIGHT = 240
const MAX_REPORTED_ERRORS = 5
const REMEMBERED_SOURCES_LIMIT = 100
const FALLBACK_TITLE = 'Artifact'
const STREAM_LINES = 5
/** 与代码流的 leading-5 一致：滚动按整行位移。 */
const STREAM_LINE_HEIGHT = 20
const MAX_ZOOM_SCALE = 3
/** 放大查看最多占窗口的 90%（与 Modal 的 max-h-[90vh] 一致），高度还要扣掉标题栏。 */
const ZOOM_VIEWPORT_RATIO = 0.9
const ZOOM_HEADER_HEIGHT = 45

/**
 * 流式结束时 Markdown 会整篇重挂载：按源码记住 Artifact 高度与「已手动运行」状态，
 * 重挂载后的新卡片直接占好高度、无需再点一次运行。
 */
const rememberedHeights = new Map<string, number>()
const startedSources = new Set<string>()

function rememberHeight(source: string, height: number) {
  rememberedHeights.delete(source)
  rememberedHeights.set(source, height)
  if (rememberedHeights.size > REMEMBERED_SOURCES_LIMIT) {
    rememberedHeights.delete(rememberedHeights.keys().next().value!)
  }
}

function clampHeight(height: number): number {
  return Math.min(ARTIFACT_MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(height)))
}

function isFrameMessage(data: unknown): data is ArtifactFrameMessage {
  if (typeof data !== 'object' || data === null) return false
  const message = data as Partial<ArtifactFrameMessage>
  if (message.source !== 'hc-artifact') return false
  if (message.type === 'size') return Number.isFinite(message.height)
  return message.type === 'error' && typeof message.message === 'string'
}

/** 进入视口附近才运行，长对话里的多个 Artifact 不会在打开时同时启动。 */
function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, ref])
  return near
}

type AssetsState =
  | { status: 'idle' }
  | { status: 'ready'; source: string; assets: Map<ArtifactAssetId, string> }
  | { status: 'error'; source: string; message: string }

function useArtifactAssets(source: string, enabled: boolean) {
  const [state, setState] = useState<AssetsState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadArtifactAssets(collectArtifactAssets(source)).then(
      (assets) => {
        if (!cancelled) setState({ status: 'ready', source, assets })
      },
      (error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '所需组件加载失败'
        setState({ status: 'error', source, message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt, enabled, source])
  // 源码变化后旧结果作废，避免短暂用旧库清单渲染新源码。
  const current = state.status !== 'idle' && state.source === source ? state : null
  return { state: current, retry: () => setAttempt((value) => value + 1) }
}

function frameDocument(
  source: string,
  assets: Map<ArtifactAssetId, string>,
  theme: ArtifactTheme,
  pixelRatio?: number,
): string {
  return buildArtifactDocument({
    source,
    assets,
    theme,
    hostOrigin: window.location.origin,
    lang: document.documentElement.lang || 'zh-CN',
    pixelRatio,
  })
}

/** 状态行左侧的呼吸圆点：颜色跟随重点色（默认灰重点色与未读圆点一样借用蓝色）。 */
function StatusDot() {
  return <span className="hc-artifact-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
}

/** 新行出现时整列上移；一次到达多行或上一段滚动还没结束时，从当前位置接着滚，不会跳动。 */
function useStreamScroll(columnRef: RefObject<HTMLDivElement | null>, lineCount: number) {
  const previousCount = useRef(lineCount)
  useLayoutEffect(() => {
    const added = lineCount - previousCount.current
    previousCount.current = lineCount
    const column = columnRef.current
    if (!column || added <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    const offset = new DOMMatrixReadOnly(getComputedStyle(column).transform).m42
    for (const animation of column.getAnimations()) animation.cancel()
    const from = Math.min(offset + added * STREAM_LINE_HEIGHT, STREAM_LINES * STREAM_LINE_HEIGHT)
    column.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
      duration: 260,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    })
  }, [columnRef, lineCount])
}

/**
 * 流式生成中：最近几行代码随输出向上滚动，顶部渐隐，当前行末尾带光标。
 * 不用展开代码也能看出在推进。
 */
function ArtifactGenerating({ source }: { source: string }) {
  const lines = source.split('\n').filter((line) => line.trim())
  const columnRef = useRef<HTMLDivElement>(null)
  useStreamScroll(columnRef, lines.length)
  // 多渲染一屏：一次滚过多行时，上方仍有内容补位。
  const firstIndex = Math.max(0, lines.length - STREAM_LINES * 2)
  const recent = lines.slice(firstIndex)
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-center gap-2 text-sm leading-5 text-neutral-500 dark:text-neutral-400">
        <StatusDot />
        {lines.length > 0 ? `正在生成 · ${lines.length} 行` : '正在生成'}
      </div>
      <div
        className="hc-artifact-stream relative overflow-hidden font-mono text-xs leading-5"
        style={{ height: STREAM_LINES * STREAM_LINE_HEIGHT }}
        aria-hidden="true"
      >
        <div ref={columnRef} className="absolute inset-x-0 bottom-0 pl-3.5">
          {recent.map((line, index) =>
            index === recent.length - 1 ? (
              // 当前行可能很长：超出时向左溢出，始终露出正在写的末尾。
              <div
                key={firstIndex + index}
                className="flex justify-end overflow-hidden text-neutral-500 dark:text-neutral-400"
              >
                <span className="min-w-full flex-none whitespace-pre">
                  {line.trimEnd()}
                  {/* 每次输出都重新挂载：输出时常亮，停顿片刻才开始闪烁。 */}
                  <span key={source.length} className="hc-artifact-caret" />
                </span>
              </div>
            ) : (
              <div
                key={firstIndex + index}
                className="overflow-hidden text-ellipsis whitespace-pre text-neutral-400 dark:text-neutral-500"
              >
                {line.trimEnd()}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

/** 加载提示延迟淡入：缓存命中时 Artifact 几十毫秒内就绪，不让文字一闪而过。 */
function ArtifactLoading({ height }: { height?: number }) {
  return (
    <div
      className={clsx(
        'hc-artifact-loading pointer-events-none flex items-center justify-center gap-2 text-sm text-neutral-400 dark:text-neutral-500',
        height === undefined && 'h-full',
      )}
      style={height === undefined ? undefined : { height }}
    >
      <StatusDot />
      正在加载
    </div>
  )
}

/** 放大查看：保持聊天卡片里的排版宽度，再整体等比放大，不超出给定范围。 */
interface ArtifactZoom {
  /** 聊天卡片里的排版宽度。 */
  width: number
  maxWidth: number
  maxHeight: number
}

/** 内容本身就比范围高时保持原大，交给弹窗滚动。 */
function zoomScale({ width, maxWidth, maxHeight }: ArtifactZoom, height: number): number {
  return Math.min(MAX_ZOOM_SCALE, Math.max(1, Math.min(maxWidth / width, maxHeight / height)))
}

interface ArtifactFrameProps {
  srcDoc: string
  title: string
  initialHeight?: number
  /** 不传时宽度铺满卡片，高度按沙箱上报的内容高度自适应。 */
  zoom?: ArtifactZoom
  onHeight?: (height: number) => void
  onError?: (message: string) => void
}

export function ArtifactFrame({
  srcDoc,
  title,
  initialHeight = PLACEHOLDER_HEIGHT,
  zoom,
  onHeight,
  onError,
}: ArtifactFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(initialHeight)
  // 首次上报尺寸意味着文档已解析、脚本已执行；主题切换会换新文档，需要重新等待。
  const [readyDoc, setReadyDoc] = useState<string | null>(null)
  const latestRef = useRef({ srcDoc, onHeight, onError })
  latestRef.current = { srcDoc, onHeight, onError }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // 沙箱是不透明源（origin 为 "null"），只能按消息来自哪个窗口识别。
      if (event.source !== frameRef.current?.contentWindow || !isFrameMessage(event.data)) return
      if (event.data.type === 'size') {
        const next = clampHeight(event.data.height)
        setHeight(next)
        setReadyDoc(latestRef.current.srcDoc)
        latestRef.current.onHeight?.(next)
      } else {
        latestRef.current.onError?.(event.data.message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const scale = zoom ? zoomScale(zoom, height) : 1
  return (
    <div
      className="relative"
      style={zoom ? { width: zoom.width * scale, height: height * scale } : undefined}
    >
      <iframe
        ref={frameRef}
        title={title}
        sandbox={ARTIFACT_FRAME_SANDBOX}
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        className={clsx(
          'block border-0 bg-transparent',
          zoom ? 'origin-top-left' : 'hc-artifact-frame w-full',
        )}
        style={zoom ? { width: zoom.width, height, transform: `scale(${scale})` } : { height }}
      />
      {readyDoc !== srcDoc && (
        <div className="absolute inset-0">
          <ArtifactLoading />
        </div>
      )}
    </div>
  )
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

interface ArtifactZoomViewProps {
  source: string
  assets: Map<ArtifactAssetId, string>
  theme: ArtifactTheme
  title: string
  /** 聊天卡片里的排版宽度与内容高度。 */
  width: number
  height: number
  onClose: () => void
}

/** 放大查看：像看图一样保持聊天里的排版与宽高比，整体等比放大到适合窗口的尺寸。 */
function ArtifactZoomView({
  source,
  assets,
  theme,
  title,
  width,
  height,
  onClose,
}: ArtifactZoomViewProps) {
  const viewport = useWindowSize()
  const zoom: ArtifactZoom = {
    width,
    maxWidth: viewport.width * ZOOM_VIEWPORT_RATIO,
    maxHeight: viewport.height * ZOOM_VIEWPORT_RATIO - ZOOM_HEADER_HEIGHT,
  }
  // 绘制像素比只在打开时按预计倍数取一次：之后缩放窗口只改变放大倍数，不重跑 Artifact。
  const [pixelRatio] = useState(() => window.devicePixelRatio * zoomScale(zoom, height))
  const srcDoc = useMemo(
    () => frameDocument(source, assets, theme, pixelRatio),
    [assets, pixelRatio, source, theme],
  )
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="content"
      bodyClassName="hc-scrollbar overflow-auto"
    >
      <ArtifactFrame srcDoc={srcDoc} title={title} initialHeight={height} zoom={zoom} />
    </Modal>
  )
}

function HeaderAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white [&>svg]:h-3.5 [&>svg]:w-3.5"
    >
      {children}
    </button>
  )
}

interface ErrorLog {
  /** 错误所属的那一份文档与运行次数。 */
  srcDoc: string | null
  runKey: number
  messages: readonly string[]
}

const NO_ERRORS: readonly string[] = []
const EMPTY_ERROR_LOG: ErrorLog = { srcDoc: null, runKey: 0, messages: NO_ERRORS }

function downloadFileName(title: string | null): string {
  return `${(title ?? FALLBACK_TITLE).replace(/[\\/:*?"<>|\s]+/g, '_')}.html`
}

interface ArtifactBlockProps {
  source: string
  /** 带语法高亮的源码节点（来自 Markdown 管线），用于「查看代码」。 */
  code: ReactNode
  /** 代码块是否已完整：流式生成中尚未闭合时只显示进度，不执行半截代码。 */
  complete: boolean
}

export function ArtifactBlock({ source, code, complete }: ArtifactBlockProps) {
  const title = useMemo(() => artifactTitle(source), [source])
  const displayTitle = title ?? FALLBACK_TITLE
  const cardRef = useRef<HTMLDivElement>(null)
  const nearViewport = useNearViewport(cardRef)
  const autoRun = useSettings((s) => s.preferences.autoRunArtifacts)
  const [manuallyStarted, setManuallyStarted] = useState(() => startedSources.has(source))
  const [showCode, setShowCode] = useState(false)
  /** 放大查看打开时记下卡片宽度，放大视图按同一宽度排版。 */
  const [zoomWidth, setZoomWidth] = useState<number | null>(null)
  const [runKey, setRunKey] = useState(0)
  const [errorLog, setErrorLog] = useState<ErrorLog>(EMPTY_ERROR_LOG)
  const [copied, setCopied] = useState(false)
  const actions = useContext(ArtifactActionsContext)
  const theme = useArtifactTheme()

  const running = complete && (autoRun || manuallyStarted)
  const { state: assets, retry } = useArtifactAssets(source, running && nearViewport)
  const srcDoc = useMemo(
    () => (assets?.status === 'ready' ? frameDocument(source, assets.assets, theme) : null),
    [assets, source, theme],
  )
  // 主题切换或重新运行都会换一份新文档，旧文档上报的错误随之作废。
  const errors =
    errorLog.srcDoc === srcDoc && errorLog.runKey === runKey ? errorLog.messages : NO_ERRORS

  const start = () => {
    startedSources.add(source)
    setManuallyStarted(true)
  }

  const rerun = () => {
    if (!running) {
      start()
      return
    }
    setRunKey((value) => value + 1)
  }

  const copy = () => {
    void copyToClipboard(source).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const download = async () => {
    try {
      const loaded = await loadArtifactAssets(collectArtifactAssets(source))
      // 下载的单文件网页在本地打开：跟随系统明暗，没有宿主窗口可回传消息。
      const html = buildArtifactDocument({ source, assets: loaded, theme: { scheme: 'auto' } })
      saveBlobToFile(new Blob([html], { type: 'text/html;charset=utf-8' }), downloadFileName(title))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败，请稍后重试')
    }
  }

  const reportError = (message: string) => {
    setErrorLog((current) => {
      const messages =
        current.srcDoc === srcDoc && current.runKey === runKey ? current.messages : NO_ERRORS
      if (messages.includes(message) || messages.length >= MAX_REPORTED_ERRORS) return current
      return { srcDoc, runKey, messages: [...messages, message] }
    })
  }

  const requestFix = () => {
    if (!actions || !cardRef.current) return
    actions.requestFix(
      buildArtifactFixPrompt(title, errors),
      cardRef.current.getBoundingClientRect(),
    )
  }

  const placeholderHeight = rememberedHeights.get(source) ?? PLACEHOLDER_HEIGHT

  let body: ReactNode
  if (!complete) {
    body = <ArtifactGenerating source={source} />
  } else if (!running) {
    body = (
      <div className="flex h-32 items-center justify-center">
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-4 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <Play className="h-3.5 w-3.5" />
          运行
        </button>
      </div>
    )
  } else if (assets?.status === 'error') {
    body = (
      <div className="flex h-32 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        <span>{assets.message}</span>
        <button
          type="button"
          onClick={retry}
          className="rounded-full border border-neutral-200 px-4 py-1 text-sm text-neutral-700 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          重试
        </button>
      </div>
    )
  } else if (srcDoc) {
    body = (
      <ArtifactFrame
        key={runKey}
        srcDoc={srcDoc}
        title={displayTitle}
        initialHeight={placeholderHeight}
        onHeight={(height) => rememberHeight(source, height)}
        onError={reportError}
      />
    )
  } else {
    body = <ArtifactLoading height={placeholderHeight} />
  }

  return (
    <div
      ref={cardRef}
      data-testid="artifact-block"
      className="hc-artifact-block my-4 overflow-hidden rounded-[1.1rem] border border-neutral-200 bg-white text-neutral-950 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
    >
      <div className="flex h-10 items-center gap-1.5 border-b border-neutral-100 pr-2 pl-4 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-300">
        <Shapes className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
        {complete && (
          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderAction
              label={showCode ? '查看效果' : '查看代码'}
              onClick={() => setShowCode((value) => !value)}
            >
              {showCode ? <Shapes /> : <Code2 />}
            </HeaderAction>
            <HeaderAction label="复制代码" onClick={copy}>
              {copied ? <Check /> : <CopyIcon />}
            </HeaderAction>
            <HeaderAction label="下载为网页文件" onClick={() => void download()}>
              <Download />
            </HeaderAction>
            <HeaderAction
              label="放大查看"
              onClick={() => setZoomWidth(cardRef.current!.clientWidth)}
              disabled={!srcDoc}
            >
              <Maximize2 />
            </HeaderAction>
            <HeaderAction label="重新运行" onClick={rerun}>
              <RotateCcw />
            </HeaderAction>
          </div>
        )}
      </div>
      {showCode && (
        <div className="hc-code-block hc-artifact-code max-h-[480px] overflow-auto">
          <pre className="px-4 pt-3 pb-5 font-mono text-[13px] leading-5">{code}</pre>
        </div>
      )}
      {/* 查看代码时只隐藏渲染结果，交互状态保留。 */}
      <div className={clsx(showCode && 'hidden')}>{body}</div>
      {errors.length > 0 && !showCode && (
        <div className="flex items-start gap-2 border-t border-neutral-100 px-4 py-2.5 text-xs leading-5 text-red-600 dark:border-neutral-800 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">
            运行出错：{errors[0]}
            {errors.length > 1 && `（另有 ${errors.length - 1} 条）`}
          </span>
          {actions && (
            <button
              type="button"
              onClick={requestFix}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
              让模型修复
            </button>
          )}
        </div>
      )}
      {zoomWidth !== null && assets?.status === 'ready' && (
        <ArtifactZoomView
          source={source}
          assets={assets.assets}
          theme={theme}
          title={displayTitle}
          width={zoomWidth}
          height={placeholderHeight}
          onClose={() => setZoomWidth(null)}
        />
      )}
    </div>
  )
}
