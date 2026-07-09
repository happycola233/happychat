import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { Menu } from 'lucide-react'
import type {
  AttachmentDTO,
  ConversationDetail,
  ConversationDTO,
  MessageDTO,
} from '@shared/types/api'
import type { ModelParams } from '@shared/types/domain'
import { isReasoningEffortAllowed, isReasoningEnabled } from '@shared/util/reasoning'
import { switchBranch } from '../api/chat'
import { abortRun, getActiveRun, regenerateRun, startRun } from '../api/runs'
import { useConversation } from '../hooks/useConversations'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'
import { useSettings } from '../store/settings'
import { useStreamStore } from '../store/stream'
import { useIsMobile, useSidebarStore } from '../store/sidebar'
import { getBrowserLocale, getBrowserTimezone } from '../lib/browserLocale'
import { pollConversationTitleAfterRun } from '../sse/conversationEvents'
import { startStream } from '../sse/streamManager'
import { toast } from '../store/toast'
import { buildPath, getSiblings } from './buildPath'
import { Composer, type ComposerMetrics } from './Composer'
import { ConversationMenu } from './ConversationMenu'
import { ArrowUpIcon } from './icons'
import { Message } from './Message'
import type { MessageEditSubmit } from './MessageEditForm'
import { CollapsibleUserMessageText } from './MessageContent'
import { ModelControlMenu } from './ModelControlMenu'
import { TimelineNav } from './TimelineNav'
import { shouldShowTimeline, timelineItemsFromMessages } from './timelineItems'
import { AnnouncementBanner } from '../announcements/AnnouncementBanner'
import { NotificationBell } from '../announcements/NotificationBell'
import type { ImageEditSource } from './imageSource'
import { getAttachmentDraftSupportIssue, toAttachmentRefs } from './attachmentDraft'
import {
  captureViewportScroll,
  restoreViewportScroll,
  type ViewportScrollSnapshot,
} from './scrollAnchor'
import { resolveAutoFollowAfterScroll, type ScrollMetrics } from './scrollFollow'
import { getConversationRunPrefs } from './runPrefs'

interface RunResult {
  runId: string
  conversation: ConversationDTO
  assistantMessage: MessageDTO
  userMessage?: MessageDTO
}

const SCROLL_BUTTON_IDLE_MS = 2400
const PROGRAMMATIC_SCROLL_RESET_MS = 1200
/** 时间轴跳转后消息顶部与视口的间距：给悬浮顶栏让位再留一点呼吸感。 */
const TIMELINE_JUMP_OFFSET_PX = 76
/** 消息列最大宽度（Tailwind max-w-3xl），用于判断顶栏按钮是否压在消息上。 */
const MESSAGE_COLUMN_MAX_WIDTH_PX = 768
/** 顶栏单侧按钮簇（含边距）所需的横向空间；两侧留白都超过它时按钮不会遮住消息。 */
const TOP_BAR_SIDE_CLEARANCE_PX = 140

export default function ChatView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const imageSize = useChatPrefs((s) => s.imageSize)
  const imageQuality = useChatPrefs((s) => s.imageQuality)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const resetActive = useChatPrefs((s) => s.resetActive)
  const autoScrollOnOpen = useSettings((s) => s.preferences.autoScrollOnOpen)
  const showScrollToBottom = useSettings((s) => s.preferences.showScrollToBottom)
  const showTimelineNav = useSettings((s) => s.preferences.showTimelineNav)
  const openMobileSidebar = useSidebarStore((s) => s.setMobileOpen)
  const isMobile = useIsMobile()
  const { data: models } = useModels()
  const model = models?.find((m) => m.id === activeModelId)
  const { data: detail } = useConversation(id)
  const stream = useStreamStore((s) => (id ? s.byConversation[id] : undefined))
  const clearStream = useStreamStore((s) => s.clear)
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null)
  const [imageSources, setImageSources] = useState<ImageEditSource[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoFollowRef = useRef(true)
  const previousScrollMetricsRef = useRef<ScrollMetrics>({ scrollTop: 0, scrollHeight: 0 })
  const autoScrollOnOpenRef = useRef(autoScrollOnOpen)
  autoScrollOnOpenRef.current = autoScrollOnOpen
  const scrollButtonIdleTimerRef = useRef<number | null>(null)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef(false)
  const terminalScrollSnapshotRef = useRef<ViewportScrollSnapshot | null>(null)
  const [scrollButtonVisible, setScrollButtonVisible] = useState(false)
  const [scrollbarGutterWidth, setScrollbarGutterWidth] = useState(0)
  const [composerMetrics, setComposerMetrics] = useState<ComposerMetrics>({
    height: 0,
    boxCenterFromBottom: 0,
  })
  const [viewportHeight, setViewportHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  // 输入框「居中→落底」平移动画只在新聊天里发出首条消息时启用；
  // 刷新页面、切换会话、点新聊天都直接落位，不做平移。
  const [dockAnimated, setDockAnimated] = useState(false)
  const dockAnimationTimerRef = useRef<number | null>(null)

  const allMessages = detail?.messages ?? []
  const messages = detail ? buildPath(allMessages, detail.conversation.activeLeafId) : []
  const streaming = stream?.status === 'streaming'

  const invalidateDetail = useCallback(
    (convId: string) => qc.invalidateQueries({ queryKey: ['conversation', convId] }),
    [qc],
  )

  const handleRunTerminal = useCallback(
    (convId: string) => {
      void invalidateDetail(convId)
      pollConversationTitleAfterRun(qc, convId)
    },
    [invalidateDetail, qc],
  )

  const clearScrollButtonIdleTimer = useCallback(() => {
    if (scrollButtonIdleTimerRef.current !== null) {
      window.clearTimeout(scrollButtonIdleTimerRef.current)
      scrollButtonIdleTimerRef.current = null
    }
  }, [])

  const hideScrollButton = useCallback(() => {
    clearScrollButtonIdleTimer()
    setScrollButtonVisible(false)
  }, [clearScrollButtonIdleTimer])

  const showScrollButtonTemporarily = useCallback(() => {
    clearScrollButtonIdleTimer()
    setScrollButtonVisible(true)
    // 每次真实滚动都续期；停止交互后统一从同一个隐藏入口淡出。
    scrollButtonIdleTimerRef.current = window.setTimeout(hideScrollButton, SCROLL_BUTTON_IDLE_MS)
  }, [clearScrollButtonIdleTimer, hideScrollButton])

  useEffect(() => {
    if (!showScrollToBottom) hideScrollButton()
  }, [hideScrollButton, showScrollToBottom])

  useEffect(() => {
    return () => {
      clearScrollButtonIdleTimer()
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current)
      }
      if (dockAnimationTimerRef.current !== null) {
        window.clearTimeout(dockAnimationTimerRef.current)
      }
    }
  }, [clearScrollButtonIdleTimer])

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const updateViewportMetrics = () => {
      // 经典滚动条会占用内容宽度；输入框需要预留同样的右侧空间才能保持同轴。
      const nextWidth = Math.max(0, scrollElement.offsetWidth - scrollElement.clientWidth)
      setScrollbarGutterWidth((currentWidth) =>
        currentWidth === nextWidth ? currentWidth : nextWidth,
      )
      // 视口高度用于计算新对话居中输入框的抬升量；宽度用于判断顶栏渐变是否需要。
      setViewportHeight((current) =>
        current === scrollElement.clientHeight ? current : scrollElement.clientHeight,
      )
      setViewportWidth((current) =>
        current === scrollElement.clientWidth ? current : scrollElement.clientWidth,
      )
    }

    updateViewportMetrics()
    const resizeObserver = new ResizeObserver(updateViewportMetrics)
    resizeObserver.observe(scrollElement)
    return () => resizeObserver.disconnect()
  }, [])

  const cancelProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = false
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = null
    }
  }, [])

  const pauseAutoFollow = useCallback(() => {
    cancelProgrammaticScroll()
    shouldAutoFollowRef.current = false
  }, [cancelProgrammaticScroll])

  const markProgrammaticScroll = useCallback((resetAfterMs: number) => {
    programmaticScrollRef.current = true
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false
      programmaticScrollTimerRef.current = null
    }, resetAfterMs)
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = scrollRef.current
      if (!el) return
      markProgrammaticScroll(behavior === 'smooth' ? PROGRAMMATIC_SCROLL_RESET_MS : 80)
      el.scrollTo({ top: el.scrollHeight, behavior })
      shouldAutoFollowRef.current = true
      previousScrollMetricsRef.current = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
      }
      hideScrollButton()
    },
    [hideScrollButton, markProgrammaticScroll],
  )

  /** 时间轴导航跳转：平滑滚到目标消息并暂停自动跟随，让用户安心回看。 */
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const container = scrollRef.current
      if (!container) return
      const anchor = container.querySelector<HTMLElement>(
        `[data-scroll-anchor="${CSS.escape(messageId)}"]`,
      )
      if (!anchor) return
      pauseAutoFollow()
      markProgrammaticScroll(PROGRAMMATIC_SCROLL_RESET_MS)
      const containerTop = container.getBoundingClientRect().top
      const targetTop =
        anchor.getBoundingClientRect().top - containerTop + container.scrollTop - TIMELINE_JUMP_OFFSET_PX
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    },
    [markProgrammaticScroll, pauseAutoFollow],
  )

  const captureTerminalScroll = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return
    terminalScrollSnapshotRef.current = captureViewportScroll(
      scrollElement,
      shouldAutoFollowRef.current,
    )
  }, [])

  // 终态正文替换与滚动补偿在同一次绘制前完成，用户看不到中间位置或空白帧。
  useLayoutEffect(() => {
    if (!stream || stream.status === 'streaming') return
    const snapshot = terminalScrollSnapshotRef.current
    const scrollElement = scrollRef.current
    if (!snapshot || !scrollElement) return
    terminalScrollSnapshotRef.current = null

    if (snapshot.autoFollowing) {
      scrollToBottom()
      return
    }

    restoreViewportScroll(scrollElement, snapshot)
    previousScrollMetricsRef.current = {
      scrollTop: scrollElement.scrollTop,
      scrollHeight: scrollElement.scrollHeight,
    }
  }, [scrollToBottom, stream])

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const currentMetrics = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoFollowRef.current = resolveAutoFollowAfterScroll({
      isAutoFollowing: shouldAutoFollowRef.current,
      isProgrammaticScroll: programmaticScrollRef.current,
      previous: previousScrollMetricsRef.current,
      current: currentMetrics,
      clientHeight: el.clientHeight,
    })
    previousScrollMetricsRef.current = currentMetrics
    if (dist <= 1) cancelProgrammaticScroll()
    if (dist <= 240) {
      hideScrollButton()
      return
    }
    if (programmaticScrollRef.current) {
      hideScrollButton()
      return
    }
    showScrollButtonTemporarily()
  }, [cancelProgrammaticScroll, hideScrollButton, showScrollButtonTemporarily])

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      // wheel 先于 scroll 触发，先暂停可以堵住“下一个 token 抢先拉回底部”的竞态。
      if (!event.ctrlKey && event.deltaY < 0) pauseAutoFollow()
    },
    [pauseAutoFollow],
  )

  const handleScrollKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const scrollsUp =
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        (event.key === ' ' && event.shiftKey)
      if (scrollsUp) pauseAutoFollow()
    },
    [pauseAutoFollow],
  )

  const reasoningEnabledForRun = (modelId: string | null, requestParams?: ModelParams | null) => {
    const runModel = models?.find((m) => m.id === modelId)
    return isReasoningEnabled(runModel, requestParams)
  }

  const applyRunResult = (res: RunResult, requestParams?: ModelParams | null) => {
    const convId = res.conversation.id
    const runModel = models?.find((m) => m.id === res.assistantMessage.modelId)
    const lastParams = getConversationRunPrefs(runModel, requestParams)
    qc.setQueryData<ConversationDetail>(['conversation', convId], (old) => {
      const base: ConversationDetail = old ?? {
        conversation: res.conversation,
        messages: [],
        lastModelId: res.assistantMessage.modelId,
        lastParams,
      }
      const ids = new Set(base.messages.map((m) => m.id))
      const toAdd = [res.userMessage, res.assistantMessage].filter(
        (m): m is MessageDTO => Boolean(m) && !ids.has((m as MessageDTO).id),
      )
      return {
        ...base,
        conversation: res.conversation,
        messages: [...base.messages, ...toAdd],
        lastModelId: res.assistantMessage.modelId,
        lastParams,
      }
    })
    qc.invalidateQueries({ queryKey: ['conversations'] })
    startStream({
      runId: res.runId,
      conversationId: convId,
      assistantMessageId: res.assistantMessage.id,
      fromSeq: -1,
      reasoningEnabled: reasoningEnabledForRun(res.assistantMessage.modelId, requestParams),
      onBeforeTerminal: captureTerminalScroll,
      onTerminal: () => handleRunTerminal(convId),
    })
    if (id !== convId) navigate(`/c/${convId}`)
  }

  // 刷新/进入会话时重连未完成的 run
  useEffect(() => {
    if (!id) return
    const existing = useStreamStore.getState().byConversation[id]
    if (existing && existing.status === 'streaming') return
    let cancelled = false
    void getActiveRun(id).then((run) => {
      if (cancelled || !run) return
      if (useStreamStore.getState().byConversation[id]?.status === 'streaming') return
      startStream({
        runId: run.runId,
        conversationId: id,
        assistantMessageId: run.assistantMessageId,
        fromSeq: -1,
        upstreamStartedAt: run.upstreamStartedAt,
        reasoningDurationMs: run.reasoningDurationMs,
        imageStartedAt: run.imageStartedAt,
        reasoningEnabled: run.reasoningEnabled,
        onBeforeTerminal: captureTerminalScroll,
        onTerminal: () => handleRunTerminal(id),
      })
    })
    return () => {
      cancelled = true
    }
  }, [id, handleRunTerminal, captureTerminalScroll])

  // 终止后交接到持久化内容
  useEffect(() => {
    if (!id || !stream || stream.status === 'streaming') return
    const msg = detail?.messages.find((m) => m.id === stream.assistantMessageId)
    if (msg && msg.status !== 'streaming') clearStream(id)
  }, [id, stream, detail, clearStream])

  // 打开会话时恢复模型/联网/思考（每会话仅应用一次，避免后续刷新覆盖临时切换）
  const appliedActiveRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const key = id ?? '__new__'
    if (appliedActiveRef.current === key) return
    if (!id) {
      appliedActiveRef.current = key
      resetActive({})
      return
    }
    if (detail && detail.conversation.id === id) {
      appliedActiveRef.current = key
      resetActive({
        modelId: detail.lastModelId,
        webSearch: detail.lastParams?.web_search,
        effort: detail.lastParams?.reasoning_effort ?? null,
      })
    }
  }, [id, detail, resetActive])

  // 流式/新内容时仅在贴底状态跟随，避免打断向上翻阅
  useEffect(() => {
    if (shouldAutoFollowRef.current) scrollToBottom()
  }, [messages.length, optimisticUser, stream?.text, stream?.reasoning, scrollToBottom])

  // 打开会话时按设置滚动到底（关闭则停留在顶部）
  useEffect(() => {
    if (autoScrollOnOpenRef.current) {
      shouldAutoFollowRef.current = true
      requestAnimationFrame(() => scrollToBottom())
    } else {
      shouldAutoFollowRef.current = false
      hideScrollButton()
      const el = scrollRef.current
      el?.scrollTo({ top: 0 })
      if (el) {
        previousScrollMetricsRef.current = {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
        }
      }
    }
  }, [hideScrollButton, id, scrollToBottom])

  const sendMut = useMutation({
    mutationFn: startRun,
    onSuccess: (res, vars) => {
      setOptimisticUser(null)
      setImageSources([])
      applyRunResult(res, vars.params)
    },
    onError: (e) => {
      setOptimisticUser(null)
      toast.error(e instanceof Error ? e.message : '发送失败')
    },
  })

  useEffect(() => {
    setImageSources([])
  }, [id])

  const regenMut = useMutation({
    mutationFn: regenerateRun,
    onSuccess: (res, vars) => applyRunResult(res, vars.params),
    onError: (e) => toast.error(e instanceof Error ? e.message : '重新生成失败'),
  })

  const switchMut = useMutation({
    mutationFn: ({ convId, messageId }: { convId: string; messageId: string }) =>
      switchBranch(convId, messageId),
    onSuccess: (_r, vars) => invalidateDetail(vars.convId),
    onError: (e) => toast.error(e instanceof Error ? e.message : '切换分支失败'),
  })

  const params = (): ModelParams => {
    const p: ModelParams = {}
    if (model?.kind === 'image') {
      p.image = { size: imageSize, quality: imageQuality }
    }
    if (model?.kind !== 'image') {
      if (activeWebSearch !== null) p.web_search = activeWebSearch
      if (isReasoningEffortAllowed(model, activeEffort)) p.reasoning_effort = activeEffort
    }
    return p
  }

  const onSend = (
    text: string,
    attachments: AttachmentDTO[],
    selectedImageSources: ImageEditSource[],
  ) => {
    if (!activeModelId) return toast.error('请先选择模型')
    if (selectedImageSources.length > 0 && model?.kind !== 'image') {
      return toast.error('请使用图片模型编辑图片')
    }
    // 从居中态发出首条消息：为接下来的「落底」变化临时开启平移动画。
    if (heroComposer) {
      setDockAnimated(true)
      if (dockAnimationTimerRef.current !== null) {
        window.clearTimeout(dockAnimationTimerRef.current)
      }
      dockAnimationTimerRef.current = window.setTimeout(() => {
        dockAnimationTimerRef.current = null
        setDockAnimated(false)
      }, 700)
    }
    shouldAutoFollowRef.current = true
    setOptimisticUser(text || null)
    sendMut.mutate({
      conversationId: id,
      modelId: activeModelId,
      text,
      params: params(),
      clientLocale: getBrowserLocale(),
      clientTimezone: getBrowserTimezone(),
      attachments: attachments.map((a) => ({
        attachmentId: a.id,
        kind: a.kind,
        filename: a.filename,
      })),
      imageSources: selectedImageSources.map((source) => ({ attachmentId: source.attachmentId })),
    })
  }

  const onUseImageSource = (source: ImageEditSource) => {
    const imageModel = model?.kind === 'image' ? model : models?.find((m) => m.kind === 'image')
    if (!imageModel) return toast.error('没有可用的图片模型')
    if (activeModelId !== imageModel.id) {
      setActiveModel(imageModel.id)
      toast.info(`已切换到 ${imageModel.displayName}`)
    }
    setImageSources([source])
  }

  const onEdit = (msg: MessageDTO, input: MessageEditSubmit): boolean => {
    if (!activeModelId) {
      toast.error('请先选择模型')
      return false
    }
    if (model?.kind === 'image' && !input.text.trim()) {
      toast.error('请输入图片生成或编辑提示词')
      return false
    }
    if (model) {
      const supportIssue = getAttachmentDraftSupportIssue(input.attachments, {
        canImage: model.capabilities.vision,
        canFile: model.capabilities.file_input,
      })
      if (supportIssue === 'image') {
        toast.error('当前模型不支持图片输入，请移除图片或切换模型')
        return false
      }
      if (supportIssue === 'file') {
        toast.error('当前模型不支持文件输入，请移除文件或切换模型')
        return false
      }
    }
    shouldAutoFollowRef.current = true
    sendMut.mutate({
      conversationId: id,
      modelId: activeModelId,
      text: input.text,
      params: params(),
      clientLocale: getBrowserLocale(),
      clientTimezone: getBrowserTimezone(),
      parentId: msg.parentId,
      attachments: toAttachmentRefs(input.attachments),
    })
    return true
  }

  const onRegenerate = (assistantMessageId: string) => {
    shouldAutoFollowRef.current = true
    regenMut.mutate({
      assistantMessageId,
      modelId: activeModelId ?? undefined,
      params: params(),
      clientLocale: getBrowserLocale(),
    })
  }

  const onSwitch = (messageId: string) => {
    if (id) switchMut.mutate({ convId: id, messageId })
  }

  const onStop = () => {
    if (stream) void abortRun(stream.runId).catch(() => undefined)
  }

  const isEmpty = !optimisticUser && messages.length === 0
  // 桌面端新对话：输入框与问候语居中；发出第一条消息后平滑滑至底部。
  const heroComposer = !id && isEmpty && !isMobile
  // 抬升量让「输入框视觉盒的几何中心」落在视口正中；盒子随行数长高时中心保持不动。
  const composerLift = heroComposer
    ? Math.max(0, Math.round(viewportHeight / 2 - composerMetrics.boxCenterFromBottom))
    : 0
  const timelineItems = timelineItemsFromMessages(messages)
  const timelineVisible = !isMobile && showTimelineNav && shouldShowTimeline(timelineItems.length)
  // 视口够宽时顶栏按钮落在消息列留白里，顶部没有内容被遮挡，不需要模糊渐变。
  const topFadeVisible =
    viewportWidth < MESSAGE_COLUMN_MAX_WIDTH_PX + TOP_BAR_SIDE_CLEARANCE_PX * 2
  const chatViewportStyle = {
    '--hc-composer-overlay-height': `${composerMetrics.height}px`,
  } as CSSProperties

  return (
    <>
      <AnnouncementBanner />

      <div className="relative min-h-0 flex-1" style={chatViewportStyle}>
        {/* 顶部悬浮栏：窄视口时用模糊交叉渐变兜住划过按钮下方的内容（宽屏按钮在消息列外，无需渐变）。 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[4.5rem]">
          {topFadeVisible && <div className="hc-top-fade" aria-hidden="true" />}
          <div className="pointer-events-auto relative flex h-14 items-center gap-1 px-2 sm:px-4">
            <button
              type="button"
              onClick={() => openMobileSidebar(true)}
              className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* 移动端：聚合模型选择器留在顶栏（桌面端在输入框内）。 */}
            {isMobile && <ModelControlMenu placement="down" align="start" variant="header" />}
            <div className="ml-auto flex items-center gap-0.5">
              <NotificationBell />
              {id && <ConversationMenu conversationId={id} />}
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          onWheel={handleWheel}
          onPointerDownCapture={cancelProgrammaticScroll}
          onKeyDown={handleScrollKeyDown}
          data-testid="chat-scroll"
          className="hc-scrollbar hc-chat-scroll h-full overflow-y-auto"
        >
          {isEmpty ? (
            // 移动端空会话在页面中央显示问候语（桌面端问候语随居中输入框走）。
            isMobile ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <h2 className="text-2xl font-medium leading-tight text-neutral-700 dark:text-neutral-200">
                    有什么可以帮你的？
                  </h2>
                </div>
              </div>
            ) : null
          ) : (
            <div className="hc-chat-scroll-content px-4 pt-[4.25rem]">
              {/* 页面留白放在限宽层外，确保消息区边界与 Composer 输入框严格对齐。 */}
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((m) => {
                  const siblings = getSiblings(allMessages, m)
                  const messageModel = models?.find((modelItem) => modelItem.id === m.modelId)
                  const branch =
                    siblings.length > 1
                      ? {
                          index: siblings.findIndex((s) => s.id === m.id),
                          total: siblings.length,
                          siblings,
                          onSelect: onSwitch,
                        }
                      : undefined
                  return (
                    <div key={m.id} data-scroll-anchor={m.id} className="hc-anim-in">
                      <Message
                        message={m}
                        live={stream && m.id === stream.assistantMessageId ? stream : undefined}
                        branch={branch}
                        busy={streaming}
                        editCapabilities={{
                          canImage: model?.capabilities.vision,
                          canFile: model?.capabilities.file_input,
                        }}
                        onEdit={m.role === 'user' ? (input) => onEdit(m, input) : undefined}
                        onRegenerate={m.role === 'assistant' ? () => onRegenerate(m.id) : undefined}
                        onUseImageSource={
                          m.role === 'assistant' && messageModel?.kind === 'image'
                            ? onUseImageSource
                            : undefined
                        }
                      />
                    </div>
                  )
                })}
                {optimisticUser && (
                  <div className="flex justify-end">
                    <div className="hc-user-bubble max-w-[85%] rounded-2xl px-4 py-2.5">
                      <CollapsibleUserMessageText text={optimisticUser} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 消息时间轴导航：仅桌面端、用户消息多于 3 条时出现在右缘中部。 */}
        {timelineVisible && (
          <div className="pointer-events-none absolute inset-y-0 right-1.5 z-20 hidden items-center md:flex">
            <div className="pointer-events-auto">
              <TimelineNav
                items={timelineItems}
                scrollContainerRef={scrollRef}
                onJump={scrollToMessage}
              />
            </div>
          </div>
        )}

        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            disabled={!scrollButtonVisible}
            tabIndex={scrollButtonVisible ? 0 : -1}
            aria-hidden={!scrollButtonVisible}
            aria-label="滚动到底部"
            title="滚动到底部"
            className={`absolute bottom-[calc(var(--hc-composer-overlay-height)+1rem)] left-1/2 z-30 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white/75 text-neutral-700 shadow-[0_4px_18px_rgb(0_0_0/0.14)] backdrop-blur-md backdrop-saturate-150 transition-[opacity,background-color,border-color,box-shadow,bottom] duration-200 ease-out hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-reduce:transition-none dark:border-white/15 dark:bg-neutral-900/70 dark:text-neutral-200 dark:shadow-[0_4px_20px_rgb(0_0_0/0.38)] dark:hover:bg-neutral-800/85 ${
              scrollButtonVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <ArrowUpIcon className="h-5 w-5 rotate-180" />
          </button>
        )}

        {/* 输入框悬浮层：桌面端新对话居中（transform 抬升）；平移动画仅在发出首条消息时启用。
            --hc-hero-glow-anchor 让光晕与输入框共用同一个几何中心锚点。 */}
        <div
          className={clsx(
            'pointer-events-none absolute inset-x-0 bottom-0 z-20',
            dockAnimated &&
              'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          )}
          style={
            {
              transform: `translateY(-${composerLift}px)`,
              '--hc-hero-glow-anchor': `${composerMetrics.boxCenterFromBottom}px`,
            } as CSSProperties
          }
        >
          {/* 居中态输入框下方的柔和光晕（随重点色自适应）。
              淡出过渡只在「发送首条消息」的落底动画期间启用，切换会话时立即消失，
              避免光晕跟着输入框滑到底部才淡出。 */}
          <div
            aria-hidden="true"
            className={clsx(
              'hc-hero-glow',
              dockAnimated && 'transition-opacity duration-500 motion-reduce:transition-none',
              heroComposer ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            aria-hidden={!heroComposer}
            className={clsx(
              'pointer-events-none absolute inset-x-0 bottom-full mb-6 text-center transition-opacity duration-300',
              heroComposer ? 'opacity-100' : 'opacity-0',
            )}
          >
            <h2 className="text-2xl font-medium leading-tight text-neutral-700 sm:text-[1.65rem] dark:text-neutral-200">
              有什么可以帮你的？
            </h2>
          </div>
          <Composer
            onSend={onSend}
            disabled={sendMut.isPending || streaming}
            streaming={streaming}
            onStop={onStop}
            modelControl={
              !isMobile ? <ModelControlMenu placement="up" align="end" variant="composer" /> : undefined
            }
            canImage={model?.capabilities.vision ?? false}
            canFile={model?.capabilities.file_input ?? false}
            imageSources={imageSources}
            scrollbarGutterWidth={scrollbarGutterWidth}
            onMetricsChange={setComposerMetrics}
            variant={heroComposer ? 'hero' : 'docked'}
            onRemoveImageSource={(attachmentId) =>
              setImageSources((items) => items.filter((item) => item.attachmentId !== attachmentId))
            }
          />
        </div>
      </div>
    </>
  )
}
