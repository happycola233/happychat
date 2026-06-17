import type { conversations, messages, models, providers, runs } from '../db/schema'

export type RunRow = typeof runs.$inferSelect
export type ModelRow = typeof models.$inferSelect
export type ProviderRow = typeof providers.$inferSelect
export type ConvRow = typeof conversations.$inferSelect
export type MsgRow = typeof messages.$inferSelect

export interface EngineContext {
  run: RunRow
  assistantMessage: MsgRow
  conversation: ConvRow
  model: ModelRow
  provider: ProviderRow
  body: Record<string, unknown>
  abortController: AbortController
}
