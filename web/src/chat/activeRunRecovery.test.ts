import { describe, expect, it } from 'vitest'
import type { ConversationDetail, MessageDTO } from '@shared/types/api'
import { ActiveRunRecoveryGate } from './activeRunRecovery'

function detailWithStatus(status: MessageDTO['status']): ConversationDetail {
  return {
    conversation: {
      id: 'conversation-1',
      title: '测试',
      modelId: null,
      folderId: null,
      activeLeafId: 'assistant-1',
      pinnedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
    messages: [
      {
        id: 'assistant-1',
        conversationId: 'conversation-1',
        parentId: null,
        role: 'assistant',
        status,
        content: [],
        modelId: null,
        modelLabel: null,
        runId: null,
        reasoningSummary: null,
        reasoningDurationMs: null,
        generationDurationMs: null,
        annotations: null,
        usage: null,
        errorMessage: null,
        createdAt: 1,
      },
    ],
    lastModelId: null,
    lastParams: null,
  }
}

describe('ActiveRunRecoveryGate', () => {
  it('refreshes a stale streaming detail already cached before active returns null', () => {
    const gate = new ActiveRunRecoveryGate()
    const staleDetail = detailWithStatus('streaming')

    gate.markNoActiveRun('conversation-1')

    expect(gate.consumeRefreshIfNeeded('conversation-1', staleDetail)).toBe(true)
    expect(gate.consumeRefreshIfNeeded('conversation-1', staleDetail)).toBe(false)
  })

  it('waits through an older complete cache for a later stale streaming response', () => {
    const gate = new ActiveRunRecoveryGate()

    gate.markNoActiveRun('conversation-1')
    expect(gate.consumeRefreshIfNeeded('conversation-1', undefined)).toBe(false)
    expect(gate.consumeRefreshIfNeeded('conversation-1', detailWithStatus('complete'))).toBe(false)
    expect(gate.consumeRefreshIfNeeded('conversation-1', detailWithStatus('streaming'))).toBe(true)
  })
})
