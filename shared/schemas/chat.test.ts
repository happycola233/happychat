import { describe, expect, it } from 'vitest'
import { sendMessageSchema } from './chat'

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
