import { describe, expect, it } from 'vitest'
import { batchDeleteConversationsSchema, moveConversationsSchema, sendMessageSchema } from './chat'

describe('sendMessageSchema', () => {
  it('accepts text beyond the removed application-level character limit', () => {
    const text = 'a'.repeat(100_001)

    const parsed = sendMessageSchema.parse({ modelId: 'test-model', text })

    expect(parsed.text).toBe(text)
  })

  it('still rejects a message without text or attachments', () => {
    expect(sendMessageSchema.safeParse({ modelId: 'test-model', text: '   ' }).success).toBe(false)
  })
})

describe('batch conversation schemas', () => {
  it('requires at least one id and caps the batch size', () => {
    expect(batchDeleteConversationsSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(
      batchDeleteConversationsSchema.safeParse({
        ids: Array.from({ length: 501 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false)
    expect(batchDeleteConversationsSchema.safeParse({ ids: ['c1', 'c2'] }).success).toBe(true)
  })

  it('move accepts a folder id or null (move out of folder)', () => {
    expect(moveConversationsSchema.parse({ ids: ['c1'], folderId: 'f1' }).folderId).toBe('f1')
    expect(moveConversationsSchema.parse({ ids: ['c1'], folderId: null }).folderId).toBeNull()
    expect(moveConversationsSchema.safeParse({ ids: ['c1'] }).success).toBe(false)
  })
})
