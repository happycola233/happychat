import type { MessageUsage, RunState } from './domain'

/**
 * SSE 线格式：每帧 `id: <seq>` + `data: <WireEvent JSON>`（不使用 event: 字段，
 * 客户端用单一 onmessage 处理并按 data.type 分发）。seq 是断线续传游标。
 */
export interface WireEvent {
  type: string
  seq: number
  data: Record<string, unknown>
}

/** 合成事件类型（与上游 response.* 共用同一 SSE 通道与 seq 计数器） */
export const RUN_EVENT_TYPE = {
  created: 'run.created',
  done: 'run.done',
  error: 'run.error',
  canceled: 'run.canceled',
  interrupted: 'run.interrupted',
} as const

export const TERMINAL_EVENT_TYPES: readonly string[] = [
  RUN_EVENT_TYPE.done,
  RUN_EVENT_TYPE.error,
  RUN_EVENT_TYPE.canceled,
  RUN_EVENT_TYPE.interrupted,
]

export function isTerminalEventType(t: string): boolean {
  return TERMINAL_EVENT_TYPES.includes(t)
}

export interface RunCreatedData {
  runId: string
  conversationId: string
  assistantMessageId: string
  startedAt: number
  reasoningEnabled: boolean
}

export interface RunDoneData {
  state: 'completed' | 'incomplete'
  messageId: string
  usage: MessageUsage
  incompleteReason: string | null
}

export interface RunErrorData {
  state: 'failed'
  message: string
  code?: string
}

export interface RunSimpleTerminalData {
  state: RunState
}
