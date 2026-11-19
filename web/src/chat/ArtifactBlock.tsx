import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { clsx } from 'clsx'
import {
  AlertCircle,
  Check,
  Download,
  Maximize2,
  Play,
  RotateCcw,
  WandSparkles,
} from 'lucide-react'
import { artifactTitle } from '@shared/util/artifactBlocks'
import {
  adaptsToColorScheme,
  ARTIFACT_CANVAS_COLORS,
  ARTIFACT_FRAME_SANDBOX,
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
import { tokenizeArtifactStreamLine } from './artifactStreamSyntax'
import { ThinkingGlyph } from './ThinkingGlyph'
import { useArtifactTheme } from './useArtifactTheme'

const MIN_FRAME_HEIGHT = 48
const PLACEHOLDER_HEIGHT = 240
const MAX_REPORTED_ERRORS = 5
const REMEMBERED_SOURCES_LIMIT = 100
const FALLBACK_TITLE = 'Artifact'
const STREAM_LINES = 6
/** 与代码流的 h-[22px] / leading-[22px] 一致：滚动按整行位移。 */
const STREAM_LINE_HEIGHT = 22
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

function renderTintedStreamLine(line: string): ReactNode {
  return tokenizeArtifactStreamLine(line).map((token, index) =>
    token.kind === 'plain' ? (
      token.text
    ) : (
      <span key={index} className={`hc-artifact-tok-${token.kind}`}>
        {token.text}
      </span>
    ),
  )
}

interface StreamLine {
  /** 源码中的真实行号（从 1 开始）；空行不显示，但仍占行号。 */
  number: number
  text: string
}

/** 生成中展示的非空代码行，行号与完整源码一致。 */
function streamLinesOf(source: string): StreamLine[] {
  return source
    .split('\n')
    .map((text, index) => ({ number: index + 1, text: text.trimEnd() }))
    .filter((line) => line.text.trim())
}

/**
 * 流式生成中：最近几行代码带行号、按语法淡着色，随输出向上滚动，顶部渐隐，当前行末尾带光标。
 * 不用展开代码也能看出在推进。
 */
function ArtifactGenerating({
  lines,
  sourceLength,
}: {
  lines: readonly StreamLine[]
  sourceLength: number
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  useStreamScroll(columnRef, lines.length)
  // 多渲染一屏：一次滚过多行时，上方仍有内容补位。
  const recent = lines.slice(Math.max(0, lines.length - STREAM_LINES * 2))
  return (
    <div
      className="hc-artifact-stream relative mx-4 mt-1 mb-4 overflow-hidden font-mono text-xs leading-[22px] tabular-nums"
      style={{ height: STREAM_LINES * STREAM_LINE_HEIGHT }}
      aria-hidden="true"
    >
      <div ref={columnRef} className="absolute inset-x-0 bottom-0">
        {recent.map((line, index) => {
          const active = index === recent.length - 1
          return (
            <div key={line.number} className="flex h-[22px] items-baseline gap-3.5">
              <span
                className={clsx(
                  'w-[22px] shrink-0 text-right text-[11px] select-none',
                  active
                    ? 'text-neutral-500 opacity-90 dark:text-neutral-400'
                    : 'text-neutral-400 opacity-55 dark:text-neutral-500',
                )}
              >
                {line.number}
              </span>
              {active ? (
                // 当前行可能很长：超出时向左溢出，始终露出正在写的末尾。
                <div className="hc-artifact-stream-active flex min-w-0 flex-1 justify-end overflow-hidden">
                  <span className="min-w-full flex-none whitespace-pre">
                    {renderTintedStreamLine(line.text)}
                    {/* 每次输出都重新挂载：输出时常亮，停顿片刻后开始闪烁。 */}
                    <span key={sourceLength} className="hc-artifact-caret" />
                  </span>
                </div>
              ) : (
                <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre">
                  {renderTintedStreamLine(line.text)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 加载提示延迟淡入：缓存命中时 Artifact 几十毫秒内就绪，不让文字一闪而过。 */
function ArtifactLoading({ height }: { height?: number }) {
  return (
    <div
      className={clsx(
        'hc-artifact-loading pointer-events-none flex items-center justify-center gap-2 text-[13px] text-neutral-400 dark:text-neutral-500',
        height === undefined && 'h-full',
      )}
      style={height === undefined ? undefined : { height }}
    >
      <ThinkingGlyph
        phase="waiting"
        size={14}
        testId="artifact-loading-glyph"
        className="hc-artifact-accent-fg"
      />
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
  /** 从生成中或手动运行进入就绪时淡入一次；打开历史消息时不播放。 */
  unveil?: boolean
  onHeight?: (height: number) => void
  onError?: (message: string) => void
}

export function ArtifactFrame({
  srcDoc,
  title,
  initialHeight = PLACEHOLDER_HEIGHT,
  zoom,
  unveil = false,
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

  const ready = readyDoc === srcDoc
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
          unveil && (ready ? 'hc-artifact-unveil' : 'opacity-0'),
        )}
        style={zoom ? { width: zoom.width, height, transform: `scale(${scale})` } : { height }}
      />
      {!ready && (
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition hover:bg-black/[0.055] hover:text-neutral-950 active:scale-95 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-white/[0.085] dark:hover:text-white [&>svg]:h-3.5 [&>svg]:w-3.5"
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
  const themed = useMemo(() => adaptsToColorScheme(source), [source])
  const streamLines = useMemo(() => (complete ? [] : streamLinesOf(source)), [complete, source])
  const displayTitle = title ?? FALLBACK_TITLE
  const cardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const nearViewport = useNearViewport(cardRef)
  const autoRun = useSettings((s) => s.preferences.autoRunArtifacts)
  const [manuallyStarted, setManuallyStarted] = useState(() => startedSources.has(source))
  const [showCode, setShowCode] = useState(false)
  /** 放大查看打开时记下渲染区宽度，放大视图按同一宽度排版。 */
  const [zoomWidth, setZoomWidth] = useState<number | null>(null)
  const [runKey, setRunKey] = useState(0)
  const [errorLog, setErrorLog] = useState<ErrorLog>(EMPTY_ERROR_LOG)
  const [copied, setCopied] = useState(false)
  // 3×3 点阵一经在生成中挂载即保留，待生成完成播放收束动画后再收起宽度；历史卡片不挂载。
  const [glyphMounted, setGlyphMounted] = useState(!complete)
  if (!complete && !glyphMounted) setGlyphMounted(true)
  const [shouldUnveil, setShouldUnveil] = useState(!complete)
  if (!complete && !shouldUnveil) setShouldUnveil(true)
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
    setShouldUnveil(true)
    setManuallyStarted(true)
  }

  const rerun = () => {
    setShouldUnveil(true)
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
    body = <ArtifactGenerating lines={streamLines} sourceLength={source.length} />
  } else if (!running) {
    body = (
      <div className="flex h-32 items-center justify-center">
        <button
          type="button"
          onClick={start}
          className="hc-artifact-run-pill inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium text-neutral-800 transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none dark:text-neutral-100"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
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
          className="hc-artifact-run-pill rounded-full px-4 py-1 text-[13px] font-medium text-neutral-800 transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none dark:text-neutral-100"
        >
          重试
        </button>
      </div>
    )
  } else if (srcDoc) {
    // 只用固定颜色的内容在深色模式下垫白底：四周留 8px 并裁出圆角，白底不贴着卡片边缘。
    // 浅色模式卡片本身是浅底，这类内容直接铺满。
    body = (
      <div className={clsx(!themed && 'dark:px-2 dark:pb-2')}>
        <div
          ref={stageRef}
          className={clsx(!themed && 'dark:overflow-hidden dark:rounded-[0.8125rem]')}
        >
          <ArtifactFrame
            key={runKey}
            srcDoc={srcDoc}
            title={displayTitle}
            initialHeight={placeholderHeight}
            unveil={shouldUnveil}
            onHeight={(height) => rememberHeight(source, height)}
            onError={reportError}
          />
        </div>
      </div>
    )
  } else {
    body = <ArtifactLoading height={placeholderHeight} />
  }

  return (
    <div
      ref={cardRef}
      data-testid="artifact-block"
      aria-busy={!complete || undefined}
      className="hc-artifact-block group/artifact my-4 overflow-hidden rounded-[1.25rem] text-neutral-950 dark:text-neutral-50"
      style={{
        backgroundColor: ARTIFACT_CANVAS_COLORS[theme.scheme === 'dark' ? 'dark' : 'light'],
      }}
    >
      <div className="flex h-10 items-center justify-between gap-2 pt-1 pr-3 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {glyphMounted && (
            <span
              className={clsx(
                'hc-artifact-glyph-slot flex shrink-0 items-center justify-center',
                complete && 'hc-artifact-glyph-leaving',
              )}
              aria-hidden="true"
            >
              <ThinkingGlyph
                phase={complete ? 'settling' : 'thinking'}
                activity={source.length}
                rippleKey={title}
                size={15}
                testId="artifact-glyph"
                className="hc-artifact-accent-fg"
              />
            </span>
          )}
          {!complete && !title ? (
            <span className="hc-artifact-shimmer min-w-0 truncate text-[13px] font-medium">
              正在生成
            </span>
          ) : (
            <span
              key={title ? 'titled' : 'fallback'}
              className={clsx(
                'min-w-0 truncate text-[13px] font-medium transition-colors',
                !complete
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 group-hover/artifact:text-neutral-900 dark:text-neutral-400 dark:group-hover/artifact:text-neutral-100',
                glyphMounted && title && 'hc-artifact-title-in',
              )}
            >
              {displayTitle}
            </span>
          )}
        </div>
        {!complete ? (
          streamLines.length > 0 && (
            <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-neutral-400 dark:text-neutral-500">
              {streamLines[streamLines.length - 1]!.number} 行
            </span>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div
              className="hc-artifact-seg"
              data-mode={showCode ? 'code' : 'preview'}
              role="group"
              aria-label="切换视图"
            >
              <span className="hc-artifact-seg-thumb" aria-hidden="true" />
              <button
                type="button"
                aria-label="查看效果"
                aria-pressed={!showCode}
                title="查看效果"
                onClick={() => setShowCode(false)}
                className={clsx(
                  'relative z-10 cursor-pointer rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none',
                  !showCode
                    ? 'text-neutral-950 dark:text-neutral-50'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
                )}
              >
                效果
              </button>
              <button
                type="button"
                aria-label="查看代码"
                aria-pressed={showCode}
                title="查看代码"
                onClick={() => setShowCode(true)}
                className={clsx(
                  'relative z-10 cursor-pointer rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none',
                  showCode
                    ? 'text-neutral-950 dark:text-neutral-50'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
                )}
              >
                代码
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-200 group-focus-within/artifact:opacity-100 group-hover/artifact:opacity-100 [@media(hover:hover)]:opacity-60">
              <HeaderAction label="复制代码" onClick={copy}>
                {copied ? <Check /> : <CopyIcon />}
              </HeaderAction>
              <HeaderAction label="下载为网页文件" onClick={() => void download()}>
                <Download />
              </HeaderAction>
              <HeaderAction
                label="放大查看"
                onClick={() =>
                  setZoomWidth(stageRef.current?.clientWidth ?? cardRef.current!.clientWidth)
                }
                disabled={!srcDoc}
              >
                <Maximize2 />
              </HeaderAction>
              <HeaderAction label="重新运行" onClick={rerun}>
                <RotateCcw />
              </HeaderAction>
            </div>
          </div>
        )}
      </div>
      {showCode && (
        <div className="hc-code-block hc-artifact-code hc-scrollbar max-h-[480px] overflow-auto">
          <pre className="px-4 pt-2 pb-5 font-mono text-[13px] leading-5">{code}</pre>
        </div>
      )}
      {/* 查看代码时只隐藏渲染结果，交互状态保留。 */}
      <div className={clsx(showCode && 'hidden')}>{body}</div>
      {errors.length > 0 && !showCode && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-[0.8125rem] bg-red-600/[0.055] px-3 py-2 text-xs leading-5 text-red-700 dark:bg-red-500/[0.11] dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">
            运行出错：{errors[0]}
            {errors.length > 1 && `（另有 ${errors.length - 1} 条）`}
          </span>
          {actions && (
            <button
              type="button"
              onClick={requestFix}
              className="hc-artifact-run-pill inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium text-neutral-800 transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none dark:text-neutral-100"
            >
              <WandSparkles className="h-3 w-3" aria-hidden="true" />
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
