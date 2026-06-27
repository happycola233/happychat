import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, Menu } from 'lucide-react'
import type {
  AttachmentDTO,
  ConversationDetail,
  ConversationDTO,
  MessageDTO,
} from '@shared/types/api'
import type { ModelParams } from '@shared/types/domain'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { switchBranch } from '../api/chat'
import { abortRun, getActiveRun, regenerateRun, startRun } from '../api/runs'
import { useConversation } from '../hooks/useConversations'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'
import { useSettings } from '../store/settings'
import { useStreamStore } from '../store/stream'
import { useSidebarStore } from '../store/sidebar'
import { getBrowserLocale } from '../lib/browserLocale'
import { pollConversationTitleAfterRun } from '../sse/conversationEvents'
import { startStream } from '../sse/streamManager'
import { toast } from '../store/toast'
import { buildPath, getSiblings } from './buildPath'
import { ChatControls } from './ChatControls'
import { Composer } from './Composer'
import { Message } from './Message'
import { CollapsibleUserMessageText } from './MessageContent'
import { ModelSelector } from './ModelSelector'
import type { ImageEditSource } from './imageSource'
import { resolveAutoFollowAfterScroll, type ScrollMetrics } from './scrollFollow'

interface RunResult {
  runId: string
  conversation: ConversationDTO
  assistantMessage: MessageDTO
  userMessage?: MessageDTO
}

const SCROLL_BUTTON_IDLE_MS = 2400
const PROGRAMMATIC_SCROLL_RESET_MS = 1200

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
  const openMobileSidebar = useSidebarStore((s) => s.setMobileOpen)
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
  const [scrollButtonVisible, setScrollButtonVisible] = useState(false)
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false)

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
    scrollButtonIdleTimerRef.current = window.setTimeout(
      hideScrollButton,
      SCROLL_BUTTON_IDLE_MS,
    )
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
    }
  }, [clearScrollButtonIdleTimer])

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

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = scrollRef.current
      if (!el) return
      programmaticScrollRef.current = true
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current)
      }
      programmaticScrollTimerRef.current = window.setTimeout(
        () => {
          programmaticScrollRef.current = false
          programmaticScrollTimerRef.current = null
        },
        behavior === 'smooth' ? PROGRAMMATIC_SCROLL_RESET_MS : 80,
      )
      el.scrollTo({ top: el.scrollHeight, behavior })
      shouldAutoFollowRef.current = true
      previousScrollMetricsRef.current = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
      }
      hideScrollButton()
      setIsScrolledFromTop(el.scrollHeight > el.clientHeight + 1)
    },
    [hideScrollButton],
  )

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
    setIsScrolledFromTop(el.scrollTop > 1)
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
    qc.setQueryData<ConversationDetail>(['conversation', convId], (old) => {
      const base: ConversationDetail = old ?? {
        conversation: res.conversation,
        messages: [],
        lastModelId: null,
        lastParams: null,
      }
      const ids = new Set(base.messages.map((m) => m.id))
      const toAdd = [res.userMessage, res.assistantMessage].filter(
        (m): m is MessageDTO => Boolean(m) && !ids.has((m as MessageDTO).id),
      )
      return { ...base, conversation: res.conversation, messages: [...base.messages, ...toAdd] }
    })
    qc.invalidateQueries({ queryKey: ['conversations'] })
    startStream({
      runId: res.runId,
      conversationId: convId,
      assistantMessageId: res.assistantMessage.id,
      fromSeq: -1,
      reasoningEnabled: reasoningEnabledForRun(res.assistantMessage.modelId, requestParams),
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
        onTerminal: () => handleRunTerminal(id),
      })
    })
    return () => {
      cancelled = true
    }
  }, [id, handleRunTerminal])

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
      setIsScrolledFromTop(false)
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
    } else {
      if (activeWebSearch !== null) p.web_search = activeWebSearch
      if (activeEffort) p.reasoning_effort = activeEffort
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
    shouldAutoFollowRef.current = true
    setOptimisticUser(text || null)
    sendMut.mutate({
      conversationId: id,
      modelId: activeModelId,
      text,
      params: params(),
      clientLocale: getBrowserLocale(),
      attachments: attachments.map((a) => ({
        attachmentId: a.id,
        kind: a.kind,
        filename: a.filename,
      })),
      imageSources: selectedImageSources.map((source) => ({ attachmentId: source.attachmentId })),
    })
  }

  const onUseImageSource = (source: ImageEditSource) => {
    const imageModel =
      model?.kind === 'image'
        ? model
        : models?.find((m) => m.kind === 'image' && m.capabilities.image_generation)
    if (!imageModel) return toast.error('没有可用的图片模型')
    if (activeModelId !== imageModel.id) {
      setActiveModel(imageModel.id)
      toast.info(`已切换到 ${imageModel.displayName}`)
    }
    setImageSources([source])
  }

  const onEdit = (msg: MessageDTO, text: string) => {
    if (!activeModelId) return toast.error('请先选择模型')
    shouldAutoFollowRef.current = true
    sendMut.mutate({
      conversationId: id,
      modelId: activeModelId,
      text,
      params: params(),
      clientLocale: getBrowserLocale(),
      parentId: msg.parentId,
    })
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

  return (
    <>
      <header
        className={`flex h-14 shrink-0 items-center gap-1 border-b px-2 transition-colors sm:px-4 ${
          isScrolledFromTop
            ? 'border-neutral-200 dark:border-neutral-800'
            : 'border-transparent'
        }`}
      >
        <button
          type="button"
          onClick={() => openMobileSidebar(true)}
          className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
          aria-label="打开侧边栏"
        >
          <Menu className="h-5 w-5" />
        </button>
        <ModelSelector />
      </header>

      <div className="relative min-h-0 flex-1">
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
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-medium leading-tight text-neutral-700 sm:text-[1.65rem] dark:text-neutral-200">
                有什么可以帮你的？
              </h2>
            </div>
          </div>
        ) : (
          <div className="hc-chat-scroll-content mx-auto max-w-3xl px-4 pt-6">
            <div className="space-y-6">
              {messages.map((m) => {
                const siblings = getSiblings(allMessages, m)
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
                  <div key={m.id} className="hc-anim-in">
                    <Message
                      message={m}
                      live={stream && m.id === stream.assistantMessageId ? stream : undefined}
                      branch={branch}
                      busy={streaming}
                      onEdit={m.role === 'user' ? (t) => onEdit(m, t) : undefined}
                      onRegenerate={m.role === 'assistant' ? () => onRegenerate(m.id) : undefined}
                      onUseImageSource={m.role === 'assistant' ? onUseImageSource : undefined}
                    />
                  </div>
                )
              })}
              {optimisticUser && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 dark:bg-neutral-800">
                    <CollapsibleUserMessageText text={optimisticUser} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            disabled={!scrollButtonVisible}
            tabIndex={scrollButtonVisible ? 0 : -1}
            aria-hidden={!scrollButtonVisible}
            aria-label="滚动到底部"
            title="滚动到底部"
            className={`absolute bottom-4 left-1/2 z-30 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white/75 text-neutral-700 shadow-[0_4px_18px_rgb(0_0_0/0.14)] backdrop-blur-md backdrop-saturate-150 transition-[opacity,background-color,border-color,box-shadow] duration-200 ease-out hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 motion-reduce:transition-none dark:border-white/15 dark:bg-neutral-900/70 dark:text-neutral-200 dark:shadow-[0_4px_20px_rgb(0_0_0/0.38)] dark:hover:bg-neutral-800/85 ${
              scrollButtonVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        )}
      </div>

      <Composer
        onSend={onSend}
        disabled={sendMut.isPending || streaming}
        streaming={streaming}
        onStop={onStop}
        leftControls={<ChatControls />}
        canImage={model?.capabilities.vision ?? false}
        canFile={model?.capabilities.file_input ?? false}
        imageSources={imageSources}
        onRemoveImageSource={(attachmentId) =>
          setImageSources((items) => items.filter((item) => item.attachmentId !== attachmentId))
        }
      />
    </>
  )
}
