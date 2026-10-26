import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { clsx } from 'clsx'
import { Menu } from 'lucide-react'
import type {
  AttachmentDTO,
  ConversationDetail,
  ConversationDTO,
  MessageDTO,
} from '@shared/types/api'
import type { ModelParams } from '@shared/types/domain'
import {
  effectiveReasoningEffort,
  isReasoningEnabled,
  reasoningEffortSelectionError,
} from '@shared/util/reasoning'
import { createConversationBranch, switchBranch } from '../api/chat'
import { ApiRequestError } from '../api/client'
import { abortRun, getActiveRun, regenerateRun, startRun } from '../api/runs'
import { useConversation } from '../hooks/useConversations'
import { useModels } from '../hooks/useModels'
import { invalidateMyQuota, useMyQuota } from '../hooks/useQuota'
import { useChatPrefs } from '../store/chat'
import { useSettings } from '../store/settings'
import { useStreamStore } from '../store/stream'
import {
  compactActivityText,
  completionPreviewFromStream,
  shouldRecordBackgroundCompletion,
  useConversationActivityStore,
} from '../store/conversationActivity'
import { useIsMobile, useSidebarStore } from '../store/sidebar'
import { getBrowserLocale, getBrowserTimezone } from '../lib/browserLocale'
import { useDevicePixelRatio } from '../lib/useDevicePixelRatio'
import { pollConversationTitleAfterRun } from '../sse/conversationEvents'
import { startStream } from '../sse/streamManager'
import { toast } from '../store/toast'
import { buildPath, getSiblings } from './buildPath'
import { Composer, type ComposerHandle, type ComposerMetrics } from './Composer'
import { ContextSettings } from './ContextSettings'
import { useContextSelection } from '../store/contextSelection'
import { ConversationMenu } from './ConversationMenu'
import { ArrowUpIcon } from './icons'
import { Message } from './Message'
import { MessageDateDivider } from './MessageDateDivider'
import type { MessageEditSubmit } from './MessageEditForm'
import { CollapsibleUserMessageText } from './MessageContent'
import { ModelControlMenu } from './ModelControlMenu'
import { QuotaNotice } from './QuotaNotice'
import { ModelUsageNotice } from './ModelUsageNotice'
import { TimelineNav } from './TimelineNav'
import {
  shouldShowTimeline,
  timelineItemsFromMessages,
  TIMELINE_JUMP_OFFSET_PX,
} from './timelineItems'
import { shouldShowTopFade } from './topFade'
import { AnnouncementBanner } from '../announcements/AnnouncementBanner'
import { ConversationDocumentTitle } from './ConversationDocumentTitle'
import { NotificationBell } from '../announcements/NotificationBell'
import type { ImageEditSource } from './imageSource'
import { toAttachmentRefs } from './attachmentDraft'
import {
  captureViewportScroll,
  restoreViewportScroll,
  type ViewportScrollSnapshot,
} from './scrollAnchor'
import { resolveAutoFollowAfterScroll, type ScrollMetrics } from './scrollFollow'
import { getConversationRunPrefs } from './runPrefs'
import { cacheRunResult, type RunResult } from './runCache'
import { MessageQueue } from './MessageQueue'
import { useMessageQueueSync } from './messageQueueSync'
import { changeMessageQueue } from '../api/messageQueues'
import type { MessageQueueAction } from '@shared/schemas/message-queue'
import { useMessageQueue } from '../store/messageQueue'
import { createRandomUuid } from '../lib/randomUuid'
import type { SendMessageInput } from '@shared/schemas/chat'
import { ActiveRunRecoveryGate } from './activeRunRecovery'
import { beginBranchCreationCooldown } from './branchCreationGuard'
import { textFromContent } from './contentText'
import { ArtifactActionsContext, type ArtifactActions } from './artifactActions'

const SCROLL_BUTTON_IDLE_MS = 2400
const PROGRAMMATIC_SCROLL_RESET_MS = 1200
/** 落底动画标记的持续时长：覆盖 500ms 平移 + 免责声明延迟淡入（300ms 延迟 + 500ms 过渡）。 */
const DOCK_ANIMATION_SETTLE_MS = 900
/** 前端只做即时反馈；真正的拦截在服务端（`prepareRun` → 429 quota_exceeded）。 */
const QUOTA_BLOCKED_HINT = '当前模型的额度已用尽，请切换其他模型或联系管理员'

function completionNoticeTitle(queryClient: QueryClient, conversationId: string): string {
  const cachedDetail = queryClient.getQueryData<ConversationDetail>([
    'conversation',
    conversationId,
  ])
  const cachedList = queryClient.getQueryData<ConversationDTO[]>(['conversations'])
  const title =
    cachedDetail?.conversation.title ??
    cachedList?.find((conversation) => conversation.id === conversationId)?.title
  const compactTitle = compactActivityText(title ?? '', 64)
  if (compactTitle) return compactTitle

  const firstUserMessage = cachedDetail?.messages.find((message) => message.role === 'user')
  const firstUserText = firstUserMessage ? textFromContent(firstUserMessage.content) : ''
  return compactActivityText(firstUserText, 64) || '新聊天'
}

/**
 * 每条消息只订阅属于自己的流式状态：增量只重渲染正在生成的那一条，整页与历史消息不随 token 重渲染。
 * 流式开始和结束都保持同一组件，过程轨展开状态与图片舞台不会因重新挂载而丢失。
 */
function ConversationMessage({
  conversationId,
  onLiveUpdate,
  ...props
}: Omit<ComponentProps<typeof Message>, 'live'> & {
  conversationId: string | undefined
  onLiveUpdate: () => void
}) {
  const messageId = props.message.id
  const live = useStreamStore((s) => {
    const stream = conversationId ? s.byConversation[conversationId] : undefined
    return stream?.assistantMessageId === messageId ? stream : undefined
  })
  useEffect(() => {
    if (live) onLiveUpdate()
  }, [live, onLiveUpdate])
  return <Message {...props} live={live} />
}

export default function ChatView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const activeWebSearch = useChatPrefs((s) => s.activeWebSearch)
  const activeXSearch = useChatPrefs((s) => s.activeXSearch)
  const activeEffort = useChatPrefs((s) => s.activeEffort)
  const imageSize = useChatPrefs((s) => s.imageSize)
  const imageQuality = useChatPrefs((s) => s.imageQuality)
  const setActiveModel = useChatPrefs((s) => s.setActiveModel)
  const resetActive = useChatPrefs((s) => s.resetActive)
  const reconcileActiveModel = useChatPrefs((s) => s.reconcileActiveModel)
  const autoScrollOnOpen = useSettings((s) => s.preferences.autoScrollOnOpen)
  const showScrollToBottom = useSettings((s) => s.preferences.showScrollToBottom)
  const showTimelineNav = useSettings((s) => s.preferences.showTimelineNav)
  const showDateDividers = useSettings(
    (s) => s.preferences.showMessageTime && s.preferences.messageTimeFormat === 'time',
  )
  const timelineNavPosition = useSettings((s) => s.preferences.timelineNavPosition)
  const showNewChatGradientGlow = useSettings((s) => s.preferences.showNewChatGradientGlow)
  const resolvedGlowColor = useSettings((s) =>
    s.preferences.newChatGlowColor === 'accent'
      ? s.preferences.accentColor
      : s.preferences.newChatGlowColor,
  )
  const openMobileSidebar = useSidebarStore((s) => s.setMobileOpen)
  const isMobile = useIsMobile()
  const devicePixelRatio = useDevicePixelRatio()
  const { data: models } = useModels()
  const model = models?.find((m) => m.id === activeModelId)
  const reasoningParams = { reasoning_effort: activeEffort ?? undefined }
  const effectiveEffort = effectiveReasoningEffort(model, reasoningParams)
  const reasoningSelectionError = reasoningEffortSelectionError(model, reasoningParams)
  const { data: quota } = useMyQuota()
  const modelQuotaExhausted = Boolean(model && quota?.blockedModelIds.includes(model.id))
  const { data: detail } = useConversation(id)
  // 页面只关心 run 身份与状态；正文、过程轨等逐 token 字段由 ConversationMessage 自行订阅。
  const stream = useStreamStore(
    useShallow((s) => {
      const current = id ? s.byConversation[id] : undefined
      return current
        ? {
            runId: current.runId,
            assistantMessageId: current.assistantMessageId,
            status: current.status,
          }
        : undefined
    }),
  )
  const messageQueue = useMessageQueue((s) => (id ? s.byConversation[id] : undefined))
  const sendRequestInFlightRef = useRef(false)
  const queuedSubmissionRef = useRef<{ fingerprint: string; id: string } | null>(null)
  const composerRef = useRef<ComposerHandle>(null)
  // 图表卡片的「让模型修复」只把说明填进输入框，由用户确认后再发送。
  const artifactActions = useMemo<ArtifactActions>(
    () => ({
      requestFix: (prompt, sourceRect) => {
        void composerRef.current?.fillDraft(prompt, [], sourceRect, async () => {})
      },
    }),
    [],
  )
  const clearStream = useStreamStore((s) => s.clear)
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null)
  const [imageSources, setImageSources] = useState<ImageEditSource[]>([])
  const [contextOpen, setContextOpen] = useState(false)
  const openContextSettings = useCallback(() => setContextOpen(true), [])
  const hasContextAttachments = useContextSelection((state) =>
    Boolean(id && state.byConversation[id]?.include.length),
  )
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null)
  // mutation.isPending 要等 React 提交后才更新；同步锁可堵住同一帧内的快速双击。
  const branchRequestInFlightRef = useRef(false)
  const currentConversationIdRef = useRef<string | undefined>(id)
  const mountedRef = useRef(true)
  const activeRunRecoveryGateRef = useRef(new ActiveRunRecoveryGate())
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
  // 输入框是否有草稿（正文/附件/图生图来源任一非空）：hero 态预热合成层的触发条件。
  const [composerHasDraft, setComposerHasDraft] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  // 输入框「居中→落底」平移动画只在新聊天里发出首条消息时启用；
  // 刷新页面、切换会话、点新聊天都直接落位，不做平移。
  const [dockAnimated, setDockAnimated] = useState(false)
  const dockAnimationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 只在路由提交后更新；cleanup 同时覆盖参数切换和离开 ChatView，避免迟到响应劫持导航。
  useLayoutEffect(() => {
    currentConversationIdRef.current = id
    useConversationActivityStore.getState().setCurrentConversation(id)
    return () => {
      // 新会话发送成功后会先乐观写入目标 id，再等待 Router 提交；旧 effect 的 cleanup
      // 不能把这个更晚的值清掉，否则极快的回复会被误判成后台完成。
      if (currentConversationIdRef.current === id) currentConversationIdRef.current = undefined
      const activity = useConversationActivityStore.getState()
      if (activity.currentConversationId === id) activity.setCurrentConversation(undefined)
    }
  }, [id])

  const allMessages = detail?.messages ?? []
  const messages = detail ? buildPath(allMessages, detail.conversation.activeLeafId) : []
  const streaming = stream?.status === 'streaming'

  useEffect(() => {
    // 刷新期间 run 也可能结束；从持久化消息补齐一次性选择的消费或失败恢复。
    if (!detail) return
    const selections = useContextSelection.getState()
    for (const message of detail.messages) {
      if (message.runId && selections.pending[message.runId] && message.status !== 'streaming') {
        selections.finish(
          message.runId,
          message.status === 'error' || message.status === 'interrupted',
        )
      }
    }
  }, [detail])

  const invalidateDetail = useCallback(
    (convId: string) => qc.invalidateQueries({ queryKey: ['conversation', convId] }),
    [qc],
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

  // 回到全新空会话（如点「新建对话」）时立刻摘掉可能仍在计时的落底标记，
  // 否则新对话输入框会先贴底、等 900ms 定时器到点才弹回居中。
  // 依赖 [id]：发送→navigate 是 undefined→convId，不会把 id 变为 undefined，
  // 故此处不会误清、也不会打断正在进行的落底动画。
  useEffect(() => {
    if (id) return
    if (dockAnimationTimerRef.current !== null) {
      window.clearTimeout(dockAnimationTimerRef.current)
      dockAnimationTimerRef.current = null
    }
    setDockAnimated(false)
  }, [id])

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
        anchor.getBoundingClientRect().top -
        containerTop +
        container.scrollTop -
        TIMELINE_JUMP_OFFSET_PX
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

  const captureConversationTerminal = useCallback(
    (conversationId: string) => {
      if (mountedRef.current && currentConversationIdRef.current === conversationId)
        captureTerminalScroll()
    },
    [captureTerminalScroll],
  )

  const handleRunTerminal = useCallback(
    function onTerminal(convId: string, runId: string) {
      const terminalStream = useStreamStore.getState().byConversation[convId]
      if (terminalStream?.runId !== runId) return
      useContextSelection
        .getState()
        .finish(runId, ['failed', 'interrupted', 'canceled'].includes(terminalStream.status))
      if (
        shouldRecordBackgroundCompletion({
          currentConversationId: useConversationActivityStore.getState().currentConversationId,
          conversationId: convId,
          runId,
          stream: terminalStream,
        })
      ) {
        useConversationActivityStore.getState().recordBackgroundCompletion({
          id: runId,
          runId,
          conversationId: convId,
          title: completionNoticeTitle(qc, convId),
          message: completionPreviewFromStream(terminalStream),
        })
      }
      void invalidateDetail(convId)
      pollConversationTitleAfterRun(qc, convId)
      invalidateMyQuota(qc)
      void qc.invalidateQueries({ queryKey: ['message-queues'] })
    },
    [invalidateDetail, qc],
  )

  const queueQuery = useMessageQueueSync({
    onBeforeTerminal: captureConversationTerminal,
    onTerminal: handleRunTerminal,
  })

  const changeQueue = async (conversationId: string, action: MessageQueueAction) => {
    try {
      return await changeMessageQueue(conversationId, action)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '队列更新失败，请稍后重试')
      void qc.invalidateQueries({ queryKey: ['message-queues'] })
      return null
    }
  }

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
    // 创建新会话时 Router 通过 startTransition 提交；先把逻辑上的当前会话切过去，
    // 防止极快终态在路由参数更新前误弹“后台回复完成”。
    if (id !== convId) {
      currentConversationIdRef.current = convId
      useConversationActivityStore.getState().setCurrentConversation(convId)
    }
    activeRunRecoveryGateRef.current.reset()
    const runModel = models?.find((m) => m.id === res.assistantMessage.modelId)
    const lastParams = getConversationRunPrefs(runModel, requestParams)
    cacheRunResult(qc, res, lastParams)
    startStream({
      runId: res.runId,
      conversationId: convId,
      assistantMessageId: res.assistantMessage.id,
      fromSeq: -1,
      reasoningEnabled: reasoningEnabledForRun(res.assistantMessage.modelId, requestParams),
      onBeforeTerminal: () => {
        if (currentConversationIdRef.current === convId) captureTerminalScroll()
      },
      onTerminal: () => handleRunTerminal(convId, res.runId),
    })
    if (id !== convId) navigate(`/c/${convId}`)
  }

  // 刷新/进入会话时重连未完成的 run
  useEffect(() => {
    activeRunRecoveryGateRef.current.reset()
  }, [id])

  useEffect(() => {
    if (!id) return
    const existing = useStreamStore.getState().byConversation[id]
    if (existing && existing.status === 'streaming') return
    let cancelled = false
    void getActiveRun(id).then((run) => {
      if (cancelled) return
      if (!run) {
        const recoveryGate = activeRunRecoveryGateRef.current
        recoveryGate.markNoActiveRun(id)
        const cachedDetail = qc.getQueryData<ConversationDetail>(['conversation', id])
        if (recoveryGate.consumeRefreshIfNeeded(id, cachedDetail)) {
          void invalidateDetail(id)
        }
        return
      }
      activeRunRecoveryGateRef.current.reset()
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
        onBeforeTerminal: () => {
          if (currentConversationIdRef.current === id) captureTerminalScroll()
        },
        onTerminal: () => handleRunTerminal(id, run.runId),
      })
    })
    return () => {
      cancelled = true
    }
  }, [id, handleRunTerminal, captureTerminalScroll, invalidateDetail, qc])

  // active 比详情先返回 null 时，等详情到达后再判断是否需要刷新旧 streaming 占位。
  useEffect(() => {
    if (id && activeRunRecoveryGateRef.current.consumeRefreshIfNeeded(id, detail)) {
      void invalidateDetail(id)
    }
  }, [id, detail, invalidateDetail])

  // 终止后交接到持久化内容
  useEffect(() => {
    if (!id || !stream || stream.status === 'streaming') return
    const msg = detail?.messages.find((m) => m.id === stream.assistantMessageId)
    if (msg && msg.status !== 'streaming') clearStream(id)
  }, [id, stream, detail, clearStream])

  // 恢复与目录校正在绘制前按顺序执行，避免新聊天闪出上一会话的模型。
  // 每次进入会话只恢复一次；目录刷新只能校正失效模型，不能覆盖手动选择。
  const appliedActiveRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const key = id ?? '__new__'
    if (appliedActiveRef.current !== key) {
      // 详情尚未返回时先恢复新聊天默认，不能沿用刚离开的会话临时值。
      const conversationDetail = detail?.conversation.id === id ? detail : undefined
      resetActive({
        modelId: conversationDetail?.lastModelId,
        webSearch: conversationDetail?.lastParams?.web_search,
        xSearch: conversationDetail?.lastParams?.x_search,
        effort: conversationDetail?.lastParams?.reasoning_effort ?? null,
      })
      // 等详情到达后再标记已恢复；离开正在加载的会话也会触发下一次恢复。
      appliedActiveRef.current = id && !conversationDetail ? undefined : key
    }
    if (models) reconcileActiveModel(models)
  }, [id, detail, models, resetActive, reconcileActiveModel])

  // 流式/新内容时仅在贴底状态跟随，避免打断向上翻阅。流式增量由正在生成的消息提交后回调；
  // run 开始、结束与交接到入库内容（可能多出用量等行）时由这里补一次。
  const followNewContent = useCallback(() => {
    if (shouldAutoFollowRef.current) scrollToBottom()
  }, [scrollToBottom])
  useEffect(() => {
    followNewContent()
  }, [messages.length, optimisticUser, stream, followNewContent])

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

  /** 服务端是额度的唯一权威：被 429 拦下后立刻刷新额度，让提示条与模型列表同步变为耗尽态。 */
  const handleRunError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiRequestError && error.code === 'quota_exceeded') {
        invalidateMyQuota(qc)
      }
      toast.error(error instanceof Error ? error.message : fallback)
    },
    [qc],
  )

  const sendMut = useMutation({
    mutationFn: startRun,
    onSuccess: (res, vars) => {
      if (vars.conversationId)
        useContextSelection
          .getState()
          .accept(vars.conversationId, res.runId, vars.contextAttachments)
      setOptimisticUser(null)
      setImageSources([])
      applyRunResult(res, vars.params)
    },
    onError: (e) => {
      setOptimisticUser(null)
      handleRunError(e, '发送失败')
    },
    onSettled: () => {
      sendRequestInFlightRef.current = false
    },
  })

  useEffect(() => {
    setImageSources([])
    setContextOpen(false)
  }, [id])

  const regenMut = useMutation({
    mutationFn: regenerateRun,
    onSuccess: (res, vars) => {
      useContextSelection.getState().accept(res.conversation.id, res.runId, vars.contextAttachments)
      applyRunResult(res, vars.params)
    },
    onError: (e) => handleRunError(e, '重新生成失败'),
  })

  const switchMut = useMutation({
    mutationFn: ({ convId, messageId }: { convId: string; messageId: string }) =>
      switchBranch(convId, messageId),
    onSuccess: (_r, vars) => invalidateDetail(vars.convId),
    onError: (e) => toast.error(e instanceof Error ? e.message : '切换分支失败'),
  })

  const branchMut = useMutation({
    mutationFn: ({
      conversationId,
      assistantMessageId,
    }: {
      conversationId: string
      assistantMessageId: string
    }) => createConversationBranch(conversationId, assistantMessageId),
    onSuccess: (branchDetail, variables) => {
      const branchConversation = branchDetail.conversation
      // 服务端返回的是新 ID 完整快照；先种缓存可让导航后的首帧直接显示全部历史。
      qc.setQueryData<ConversationDetail>(['conversation', branchConversation.id], branchDetail)
      qc.setQueryData<ConversationDTO[]>(['conversations'], (current) =>
        current
          ? [branchConversation, ...current.filter((item) => item.id !== branchConversation.id)]
          : current,
      )
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('已创建新的分支对话')
      // 慢附件复制期间用户可能已主动切换会话；此时只更新缓存，不抢走用户当前页面。
      if (mountedRef.current && currentConversationIdRef.current === variables.conversationId) {
        navigate(`/c/${branchConversation.id}`)
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '创建分支对话失败')
    },
    onSettled: () => {
      branchRequestInFlightRef.current = false
      if (mountedRef.current) setBranchingMessageId(null)
    },
  })

  const params = (): ModelParams => {
    const p: ModelParams = {}
    if (model?.kind === 'image') {
      p.image = { size: imageSize, quality: imageQuality }
    }
    if (model?.kind !== 'image') {
      if (model?.kind !== 'chat') {
        if (activeWebSearch !== null) p.web_search = activeWebSearch
        if (activeXSearch !== null) p.x_search = activeXSearch
      }
      // 显式发送界面高亮的档位，避免管理员默认值变更后本次请求悄悄换档。
      if (effectiveEffort) p.reasoning_effort = effectiveEffort
    }
    return p
  }

  const onSend = async (
    text: string,
    attachments: AttachmentDTO[],
    selectedImageSources: ImageEditSource[],
  ): Promise<boolean> => {
    if (!model) {
      toast.error(models ? '当前账号暂无可用模型，请联系管理员' : '模型列表加载中，请稍后再试')
      return false
    }
    if (reasoningSelectionError) {
      toast.error(reasoningSelectionError)
      return false
    }
    if (selectedImageSources.length > 0 && model.kind !== 'image') {
      toast.error('请使用图片模型编辑图片')
      return false
    }
    if (model.kind === 'image' && !text.trim()) {
      toast.error('请输入图片生成或编辑提示词')
      return false
    }
    if (modelQuotaExhausted) {
      toast.error(QUOTA_BLOCKED_HINT)
      return false
    }
    const input: SendMessageInput = {
      conversationId: id,
      contextPolicy: id ? undefined : useSettings.getState().preferences.contextPolicy,
      contextAttachments: id ? useContextSelection.getState().byConversation[id] : undefined,
      modelId: model.id,
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
    }
    const currentStream = id ? useStreamStore.getState().byConversation[id] : undefined
    const currentQueue = id ? useMessageQueue.getState().byConversation[id] : undefined
    if (
      id &&
      (currentStream?.status === 'streaming' ||
        currentQueue?.items.length ||
        currentQueue?.sendingId ||
        currentQueue?.waitingRunId ||
        queuedSubmissionRef.current)
    ) {
      const runPrefs = getConversationRunPrefs(model, input.params)
      input.params = { ...input.params, ...runPrefs }
      const fingerprint = JSON.stringify({ input, attachments, selectedImageSources })
      if (queuedSubmissionRef.current?.fingerprint !== fingerprint) {
        queuedSubmissionRef.current = { fingerprint, id: createRandomUuid() }
      }
      const saved = await changeQueue(id, {
        type: 'enqueue',
        message: {
          id: queuedSubmissionRef.current.id,
          input,
          attachments,
          imageSources: selectedImageSources,
          modelName: model.displayName,
          runPrefs,
          reasoningEnabled: isReasoningEnabled(model, input.params),
        },
        parentId:
          currentQueue?.parentId ??
          currentStream?.assistantMessageId ??
          detail?.conversation.activeLeafId ??
          null,
      })
      if (!saved) return false
      queuedSubmissionRef.current = null
      // 加入队列即转交这一次选择，下一条草稿不能再次自动携带；失败时仍保留在队列项中。
      if (input.contextAttachments)
        useContextSelection.getState().set(id, { include: [], exclude: [] })
      setImageSources([])
      return true
    }
    if (sendRequestInFlightRef.current) return false
    sendRequestInFlightRef.current = true
    // 从居中态发出首条消息：为接下来的「落底」变化临时开启平移动画。
    if (heroComposer) {
      setDockAnimated(true)
      if (dockAnimationTimerRef.current !== null) {
        window.clearTimeout(dockAnimationTimerRef.current)
      }
      dockAnimationTimerRef.current = window.setTimeout(() => {
        dockAnimationTimerRef.current = null
        setDockAnimated(false)
      }, DOCK_ANIMATION_SETTLE_MS)
    }
    shouldAutoFollowRef.current = true
    setOptimisticUser(text || null)
    sendMut.mutate(input)
    return true
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

  const restoreQueuedMessage = async (messageId: string, sourceRect: DOMRect) => {
    if (!id) return
    const queue = useMessageQueue.getState().byConversation[id]
    const message = queue?.items.find((item) => item.id === messageId)
    if (!queue || !message || queue.sendingId === messageId) return
    try {
      const restored = await composerRef.current!.fillDraft(
        message.input.text,
        message.attachments,
        sourceRect,
        async () => {
          await changeMessageQueue(id, { type: 'take', messageId })
        },
      )
      if (!restored) return
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '暂时无法编辑，请稍后重试')
      return
    }
    setImageSources(message.imageSources)
    if (message.input.contextAttachments)
      useContextSelection.getState().set(id, message.input.contextAttachments)
    resetActive({
      modelId: message.input.modelId,
      webSearch: message.input.params?.web_search,
      xSearch: message.input.params?.x_search,
      effort: message.input.params?.reasoning_effort,
    })
    if (message.input.params?.image) {
      const prefs = useChatPrefs.getState()
      prefs.setImageSize(message.input.params.image.size ?? 'auto')
      prefs.setImageQuality(message.input.params.image.quality ?? 'auto')
    }
  }

  const onEdit = (msg: MessageDTO, input: MessageEditSubmit): boolean => {
    if (
      id &&
      (useStreamStore.getState().byConversation[id]?.status === 'streaming' ||
        useMessageQueue.getState().byConversation[id]?.sendingId)
    )
      return false
    if (!model) {
      toast.error(models ? '当前账号暂无可用模型，请联系管理员' : '模型列表加载中，请稍后再试')
      return false
    }
    if (reasoningSelectionError) {
      toast.error(reasoningSelectionError)
      return false
    }
    if (model.kind === 'image' && !input.text.trim()) {
      toast.error('请输入图片生成或编辑提示词')
      return false
    }
    if (modelQuotaExhausted) {
      toast.error(QUOTA_BLOCKED_HINT)
      return false
    }
    // 用户主动编辑历史时先暂停队列，避免下一条消息抢在新分支创建前发送。
    shouldAutoFollowRef.current = true
    sendMut.mutate({
      conversationId: id,
      modelId: model.id,
      text: input.text,
      contextAttachments: id ? useContextSelection.getState().byConversation[id] : undefined,
      params: params(),
      clientLocale: getBrowserLocale(),
      clientTimezone: getBrowserTimezone(),
      parentId: msg.parentId,
      attachments: toAttachmentRefs(input.attachments),
    })
    return true
  }

  const onRegenerate = (assistantMessageId: string) => {
    if (
      id &&
      (useStreamStore.getState().byConversation[id]?.status === 'streaming' ||
        useMessageQueue.getState().byConversation[id]?.sendingId)
    )
      return
    if (!model) {
      toast.error(models ? '当前账号暂无可用模型，请联系管理员' : '模型列表加载中，请稍后再试')
      return
    }
    if (reasoningSelectionError) {
      toast.error(reasoningSelectionError)
      return
    }
    if (modelQuotaExhausted) {
      toast.error(QUOTA_BLOCKED_HINT)
      return
    }
    shouldAutoFollowRef.current = true
    regenMut.mutate({
      assistantMessageId,
      contextAttachments: id ? useContextSelection.getState().byConversation[id] : undefined,
      modelId: model.id,
      params: params(),
      clientLocale: getBrowserLocale(),
    })
  }

  const onSwitch = (messageId: string) => {
    if (id) switchMut.mutate({ convId: id, messageId })
  }

  const onCreateBranch = (assistantMessageId: string) => {
    if (!id || branchRequestInFlightRef.current) return
    if (!beginBranchCreationCooldown()) return
    branchRequestInFlightRef.current = true
    setBranchingMessageId(assistantMessageId)
    branchMut.mutate({ conversationId: id, assistantMessageId })
  }

  const onStop = () => {
    if (stream) void abortRun(stream.runId).catch(() => toast.error('停止失败，请重试'))
  }

  const isEmpty = !optimisticUser && messages.length === 0
  // 桌面端新对话：输入框与问候语居中；发出第一条消息后平滑滑至底部。
  // 落底动画进行中（dockAnimated）一律视为「非居中」：发送成功后 onSuccess 会先以紧急更新
  // 清空 optimisticUser，而 navigate 的 id 更新走 React Router 的 startTransition（非紧急），
  // 中间会提交一帧「id 未更新、optimisticUser 已清空」的瞬态渲染。若此时各处仍读到 hero，
  // 输入框/光晕/问候语/底部遮罩会一起抽回居中位再落一次（表现为「下沉被抽回去又下沉」）。
  // 把落底窗口并入判定，这一帧就稳定为落底态；dockAnimated 只由定时器摘除，不会打断整段动画。
  const heroComposer = !id && isEmpty && !isMobile && !dockAnimated
  // 抬升量让「输入框视觉盒的几何中心」落在视口正中；盒子随行数长高时中心保持不动。
  // 取整对齐物理像素而非 CSS 像素：Windows 125%/150% 缩放下整数 CSS 像素可能落在
  // 半个物理像素上，升层后整层位图被半像素重采样，问候语与输入框文字随机发虚。
  const composerLift = heroComposer
    ? Math.max(
        0,
        Math.round((viewportHeight / 2 - composerMetrics.boxCenterFromBottom) * devicePixelRatio) /
          devicePixelRatio,
      )
    : 0
  // 升层（will-change）时机：合成层上的文字只有灰度抗锯齿、又易受半像素重采样影响而发虚，
  // 所以居中静止阅读问候语时不升层，走正常渲染路径保证清晰；用户一动笔（有草稿）才预热——
  // 升层与光晕大渐变的光栅化在打字期完成，发送必先有草稿，发送瞬间依旧没有「首次升层」掉帧，
  // 且落底 transform 在合成线程跑，不被首条消息挂载的主线程重排阻塞。落位后撤下标记。
  const composerLayerWarm = (heroComposer && composerHasDraft) || dockAnimated
  const timelineItems = timelineItemsFromMessages(messages)
  const timelineVisible = !isMobile && showTimelineNav && shouldShowTimeline(timelineItems.length)
  const topFadeVisible = shouldShowTopFade({
    viewportWidth,
    hasConversation: Boolean(id),
    hasVisibleMessages: !isEmpty,
    isDocking: dockAnimated,
  })
  const chatViewportStyle = {
    '--hc-composer-overlay-height': `${composerMetrics.height}px`,
  } as CSSProperties

  return (
    <ArtifactActionsContext.Provider value={artifactActions}>
      <ConversationDocumentTitle conversationId={id} persistedTitle={detail?.conversation.title} />
      <AnnouncementBanner />

      <div className="relative min-h-0 flex-1" style={chatViewportStyle}>
        {/* 顶部悬浮栏：仅消息可能划过按钮时按视口宽度显示渐变；空白新聊天保持透明。 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[4.5rem]">
          {topFadeVisible && <div className="hc-top-fade" aria-hidden="true" />}
          {/* 透明顶栏只让实际控件接收事件；中间留白必须透传给下方 sticky 思考状态。 */}
          <div className="pointer-events-none relative flex h-14 items-center gap-1 px-2 sm:px-4">
            <button
              type="button"
              onClick={() => openMobileSidebar(true)}
              className="pointer-events-auto rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* 移动端：聚合模型选择器留在顶栏（桌面端在输入框内）。 */}
            {isMobile && (
              <div className="pointer-events-auto">
                <ModelControlMenu placement="down" align="start" variant="header" />
              </div>
            )}
            <div className="pointer-events-auto relative ml-auto flex items-center gap-1">
              {id && detail && (
                <ContextSettings
                  key={id}
                  conversation={detail.conversation}
                  messages={messages}
                  allMessages={allMessages}
                  imageModel={model?.kind === 'image'}
                  canImage={Boolean(model?.capabilities.vision)}
                  canFile={Boolean(model?.capabilities.file_input)}
                  open={contextOpen}
                  streaming={streaming}
                  onOpenChange={setContextOpen}
                />
              )}
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
          // 顶部渐变显示时顶栏按钮会压在消息列上方，吸顶控件需要让出顶栏这一行。
          data-top-bar-overlap={topFadeVisible || undefined}
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
                {messages.map((m, index) => {
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
                      {showDateDividers && (
                        <MessageDateDivider
                          timestamp={m.createdAt}
                          previousTimestamp={messages[index - 1]?.createdAt}
                        />
                      )}
                      <ConversationMessage
                        conversationId={id}
                        onLiveUpdate={followNewContent}
                        message={m}
                        costDisplay={detail?.messageCostDisplay}
                        branch={branch}
                        busy={
                          streaming ||
                          Boolean(messageQueue?.sendingId) ||
                          sendMut.isPending ||
                          regenMut.isPending ||
                          branchMut.isPending
                        }
                        editAttachmentSupport={{
                          canImage: model?.capabilities.vision,
                          canFile: model?.capabilities.file_input,
                          modelKind: model?.kind,
                        }}
                        onEdit={m.role === 'user' ? (input) => onEdit(m, input) : undefined}
                        onRegenerate={m.role === 'assistant' ? () => onRegenerate(m.id) : undefined}
                        onCreateBranch={
                          m.role === 'assistant' ? () => onCreateBranch(m.id) : undefined
                        }
                        creatingBranch={branchingMessageId === m.id}
                        onUseImageSource={
                          m.role === 'assistant' && messageModel?.kind === 'image'
                            ? onUseImageSource
                            : undefined
                        }
                        onOpenContextSettings={id && detail ? openContextSettings : undefined}
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

        {/* 时间轴可切换左右两侧，预览始终向聊天区域内侧展开。 */}
        {timelineVisible && (
          <div
            className={clsx(
              'pointer-events-none absolute bottom-[calc(var(--hc-composer-overlay-height)+1rem)] top-20 z-20 hidden items-center md:flex',
              timelineNavPosition === 'left' ? 'left-3' : 'right-3',
            )}
          >
            <div className="pointer-events-auto">
              <TimelineNav
                key={id}
                conversationId={id!}
                position={timelineNavPosition}
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
              willChange: composerLayerWarm ? 'transform' : undefined,
              '--hc-hero-glow-anchor': `${composerMetrics.boxCenterFromBottom}px`,
            } as CSSProperties
          }
        >
          {/* 居中态输入框下方的柔和光晕（跟随重点色或使用独立配色）。
              淡出过渡只在「发送首条消息」的落底动画期间启用，切换会话时立即消失，
              避免光晕跟着输入框滑到底部才淡出。 */}
          <div
            aria-hidden="true"
            data-glow-color={resolvedGlowColor}
            className={clsx(
              'hc-hero-glow',
              dockAnimated && 'transition-opacity duration-500 motion-reduce:transition-none',
              // 光晕大渐变提前光栅化到自有合成层，落底淡出走合成线程、不逐帧重绘。
              showNewChatGradientGlow && composerLayerWarm && '[will-change:opacity]',
              showNewChatGradientGlow && heroComposer ? 'opacity-100' : 'opacity-0',
            )}
          />
          {/* 问候语的淡出过渡同样只在落底动画期间启用，切换会话时立即消失，
              避免残影在已落底的输入框上方闪一下。 */}
          <div
            aria-hidden={!heroComposer}
            className={clsx(
              'pointer-events-none absolute inset-x-0 bottom-full mb-6 text-center',
              dockAnimated && 'transition-opacity duration-300 motion-reduce:transition-none',
              heroComposer ? 'opacity-100' : 'opacity-0',
            )}
          >
            <h2 className="text-2xl font-medium leading-tight text-neutral-700 sm:text-[1.65rem] dark:text-neutral-200">
              有什么可以帮你的？
            </h2>
          </div>
          <Composer
            ref={composerRef}
            onSend={onSend}
            queueing={streaming || Boolean(messageQueue?.items.length)}
            queue={
              id &&
              messageQueue && (
                <MessageQueue
                  key={id}
                  queue={messageQueue}
                  onEdit={restoreQueuedMessage}
                  onRemove={(messageId) => {
                    void changeQueue(id, { type: 'remove', messageId })
                  }}
                  onReorderStart={() => {
                    void changeQueue(id, { type: 'hold' })
                  }}
                  onReorderEnd={(messageId, targetId) => {
                    void changeQueue(id, { type: 'reorder', messageId, targetId })
                  }}
                  onResume={() => {
                    void changeQueue(id, { type: 'resume' })
                  }}
                />
              )
            }
            hasContextAttachments={hasContextAttachments && model?.kind !== 'image'}
            notice={
              <>
                {model && <ModelUsageNotice key={`${id ?? 'new'}:${model.id}`} model={model} />}
                <QuotaNotice />
                {queueQuery.isError && (
                  <button
                    type="button"
                    onClick={() => void queueQuery.refetch()}
                    className="mb-2 text-sm text-neutral-500"
                  >
                    队列加载失败，点击重试
                  </button>
                )}
              </>
            }
            disabled={
              queueQuery.isPending ||
              queueQuery.isError ||
              sendMut.isPending ||
              regenMut.isPending ||
              !model ||
              modelQuotaExhausted ||
              !!reasoningSelectionError
            }
            streaming={streaming}
            onStop={onStop}
            modelControl={
              !isMobile ? (
                // 新对话输入框居中时上下都窄，聚合菜单改为向左侧弹；沉底后恢复向上弹。
                <ModelControlMenu
                  placement={heroComposer ? 'left' : 'up'}
                  align="end"
                  variant="composer"
                />
              ) : undefined
            }
            canImage={model?.capabilities.vision ?? false}
            canFile={model?.capabilities.file_input ?? false}
            modelKind={model?.kind}
            imageSources={imageSources}
            scrollbarGutterWidth={scrollbarGutterWidth}
            onMetricsChange={setComposerMetrics}
            onDraftPresenceChange={setComposerHasDraft}
            variant={heroComposer ? 'hero' : 'docked'}
            dockAnimated={dockAnimated}
            onRemoveImageSource={(attachmentId) =>
              setImageSources((items) => items.filter((item) => item.attachmentId !== attachmentId))
            }
          />
        </div>
      </div>
    </ArtifactActionsContext.Provider>
  )
}
