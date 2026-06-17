import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type {
  AttachmentDTO,
  ConversationDetail,
  ConversationDTO,
  MessageDTO,
} from '@shared/types/api'
import type { ModelParams } from '@shared/types/domain'
import { switchBranch } from '../api/chat'
import { abortRun, getActiveRun, regenerateRun, startRun } from '../api/runs'
import { useConversation } from '../hooks/useConversations'
import { useModels } from '../hooks/useModels'
import { useChatPrefs } from '../store/chat'
import { useStreamStore } from '../store/stream'
import { startStream } from '../sse/streamManager'
import { toast } from '../store/toast'
import { buildPath, getSiblings } from './buildPath'
import { ChatControls } from './ChatControls'
import { Composer } from './Composer'
import { Message } from './Message'
import { ModelSelector } from './ModelSelector'

interface RunResult {
  runId: string
  conversation: ConversationDTO
  assistantMessage: MessageDTO
  userMessage?: MessageDTO
}

export default function ChatView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const prefs = useChatPrefs()
  const { data: models } = useModels()
  const model = models?.find((m) => m.id === prefs.selectedModelId)
  const { data: detail } = useConversation(id)
  const stream = useStreamStore((s) => (id ? s.byConversation[id] : undefined))
  const clearStream = useStreamStore((s) => s.clear)
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const allMessages = detail?.messages ?? []
  const messages = detail ? buildPath(allMessages, detail.conversation.activeLeafId) : []
  const streaming = stream?.status === 'streaming'

  const invalidateDetail = useCallback(
    (convId: string) => qc.invalidateQueries({ queryKey: ['conversation', convId] }),
    [qc],
  )

  const applyRunResult = (res: RunResult) => {
    const convId = res.conversation.id
    qc.setQueryData<ConversationDetail>(['conversation', convId], (old) => {
      const base = old ?? { conversation: res.conversation, messages: [] }
      const ids = new Set(base.messages.map((m) => m.id))
      const toAdd = [res.userMessage, res.assistantMessage].filter(
        (m): m is MessageDTO => Boolean(m) && !ids.has((m as MessageDTO).id),
      )
      return { conversation: res.conversation, messages: [...base.messages, ...toAdd] }
    })
    qc.invalidateQueries({ queryKey: ['conversations'] })
    startStream({
      runId: res.runId,
      conversationId: convId,
      assistantMessageId: res.assistantMessage.id,
      fromSeq: -1,
      onTerminal: () => invalidateDetail(convId),
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
        onTerminal: () => invalidateDetail(id),
      })
    })
    return () => {
      cancelled = true
    }
  }, [id, invalidateDetail])

  // 终止后交接到持久化内容
  useEffect(() => {
    if (!id || !stream || stream.status === 'streaming') return
    const msg = detail?.messages.find((m) => m.id === stream.assistantMessageId)
    if (msg && msg.status !== 'streaming') clearStream(id)
  }, [id, stream, detail, clearStream])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, optimisticUser, stream?.text, stream?.reasoning])

  const sendMut = useMutation({
    mutationFn: startRun,
    onSuccess: (res) => {
      setOptimisticUser(null)
      applyRunResult(res)
    },
    onError: (e) => {
      setOptimisticUser(null)
      toast.error(e instanceof Error ? e.message : '发送失败')
    },
  })

  const regenMut = useMutation({
    mutationFn: regenerateRun,
    onSuccess: applyRunResult,
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
      p.image = { size: prefs.imageSize, quality: prefs.imageQuality }
    } else {
      if (prefs.webSearch) p.web_search = true
      if (prefs.reasoningEffort) p.reasoning_effort = prefs.reasoningEffort
    }
    return p
  }

  const onSend = (text: string, attachments: AttachmentDTO[]) => {
    if (!prefs.selectedModelId) return toast.error('请先选择模型')
    setOptimisticUser(text || null)
    sendMut.mutate({
      conversationId: id,
      modelId: prefs.selectedModelId,
      text,
      params: params(),
      attachments: attachments.map((a) => ({
        attachmentId: a.id,
        kind: a.kind,
        filename: a.filename,
      })),
    })
  }

  const onEdit = (msg: MessageDTO, text: string) => {
    if (!prefs.selectedModelId) return toast.error('请先选择模型')
    sendMut.mutate({
      conversationId: id,
      modelId: prefs.selectedModelId,
      text,
      params: params(),
      parentId: msg.parentId,
    })
  }

  const onRegenerate = (assistantMessageId: string) => {
    regenMut.mutate({
      assistantMessageId,
      modelId: prefs.selectedModelId ?? undefined,
      params: params(),
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
      <header className="flex h-14 shrink-0 items-center border-b border-neutral-200 px-4 dark:border-neutral-800">
        <ModelSelector />
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-medium text-neutral-700 dark:text-neutral-200">
                有什么可以帮你的？
              </h2>
              <p className="mt-2 text-sm text-neutral-400">在下方输入消息开始对话</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
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
                <Message
                  key={m.id}
                  message={m}
                  live={stream && m.id === stream.assistantMessageId ? stream : undefined}
                  branch={branch}
                  busy={streaming}
                  onEdit={m.role === 'user' ? (t) => onEdit(m, t) : undefined}
                  onRegenerate={m.role === 'assistant' ? () => onRegenerate(m.id) : undefined}
                />
              )
            })}
            {optimisticUser && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px] whitespace-pre-wrap dark:bg-neutral-800">
                  {optimisticUser}
                </div>
              </div>
            )}
          </div>
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
      />
    </>
  )
}
