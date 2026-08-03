import { describe, expect, it } from 'vitest'
import {
  collectProviderOpaqueStrings,
  redactProviderOpaqueContent,
  sanitizeEventData,
} from './event-sanitize'

describe('sanitizeEventData', () => {
  it.each(['response.output_item.added', 'response.output_item.done'])(
    'removes reasoning ciphertext from %s',
    (type) => {
      const original = {
        output_index: 0,
        item: {
          id: 'reasoning-1',
          type: 'reasoning',
          encrypted_content: 'opaque-ciphertext',
          summary: [{ type: 'summary_text', text: '摘要' }],
        },
      }

      expect(sanitizeEventData(type, original)).toEqual({
        output_index: 0,
        item: {
          id: 'reasoning-1',
          type: 'reasoning',
          encrypted_content: null,
          encrypted_content_omitted: true,
          summary: [{ type: 'summary_text', text: '摘要' }],
        },
      })
    },
  )

  it.each(['response.completed', 'response.incomplete', 'response.failed'])(
    'removes reasoning ciphertext from terminal %s output',
    (type) => {
      const original = {
        response: {
          id: 'response-1',
          output: [
            { id: 'reasoning-1', type: 'reasoning', encrypted_content: 'opaque-ciphertext' },
            { id: 'message-1', type: 'message', content: [] },
          ],
        },
      }

      expect(sanitizeEventData(type, original)).toEqual({
        response: {
          id: 'response-1',
          output: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              encrypted_content: null,
              encrypted_content_omitted: true,
            },
            { id: 'message-1', type: 'message', content: [] },
          ],
        },
      })
    },
  )

  it('does not alter non-reasoning items that happen to contain encrypted_content', () => {
    const original = {
      item: { id: 'message-1', type: 'message', encrypted_content: 'application-field' },
    }

    const sanitized = sanitizeEventData('response.output_item.done', original)

    expect(sanitized).toBe(original)
    expect(sanitized).toEqual(original)
  })

  it('continues to remove image generation base64 results', () => {
    const original = {
      item: { id: 'image-1', type: 'image_generation_call', result: 'base64-image' },
    }

    expect(sanitizeEventData('response.output_item.done', original)).toEqual({
      item: {
        id: 'image-1',
        type: 'image_generation_call',
        result: null,
        result_omitted: true,
      },
    })
  })

  it('does not mutate the original nested response', () => {
    const original = {
      response: {
        output: [
          { type: 'reasoning', encrypted_content: 'opaque-ciphertext' },
          { type: 'image_generation_call', result: 'base64-image' },
        ],
      },
    }
    const snapshot = structuredClone(original)

    const sanitized = sanitizeEventData('response.completed', original)

    expect(original).toEqual(snapshot)
    expect(sanitized).not.toBe(original)
    expect(sanitized.response).not.toBe(original.response)
  })

  it('redacts known request ciphertext from persisted error events', () => {
    const original = {
      message: 'The reasoning item opaque-request-ciphertext could not be decrypted.',
    }

    expect(sanitizeEventData('error', original, ['opaque-request-ciphertext'])).toEqual({
      message: 'The reasoning item [provider opaque content omitted] could not be decrypted.',
    })
    expect(original.message).toContain('opaque-request-ciphertext')
  })

  it('redacts terminal error echoes while preserving raw objects for engine handling', () => {
    const original = {
      response: {
        output: [{ type: 'reasoning', encrypted_content: 'terminal-ciphertext' }],
        error: {
          message: 'Invalid payload: {"encrypted_content":"terminal-ciphertext"}',
        },
      },
    }

    const sanitized = sanitizeEventData('response.failed', original)

    expect(JSON.stringify(sanitized)).not.toContain('terminal-ciphertext')
    expect(sanitized).toMatchObject({
      response: {
        output: [
          {
            type: 'reasoning',
            encrypted_content: null,
            encrypted_content_omitted: true,
          },
        ],
        error: { message: 'Invalid payload: {"encrypted_content":null}' },
      },
    })
    expect(JSON.stringify(original)).toContain('terminal-ciphertext')
  })

  it('collects Responses and Anthropic opaque string values', () => {
    expect(
      collectProviderOpaqueStrings({
        input: [
          { type: 'reasoning', encrypted_content: 'cipher-1' },
          { nested: { encrypted_content: 'cipher-2' } },
          { type: 'thinking', signature: 'signature-1' },
          { type: 'redacted_thinking', data: 'redacted-1' },
          { citations: [{ encrypted_index: 'citation-1' }] },
          { encrypted_content: null },
        ],
      }),
    ).toEqual(['cipher-1', 'cipher-2', 'signature-1', 'redacted-1', 'citation-1'])
    expect(redactProviderOpaqueContent('{"encrypted_content":"cipher-1"}')).toBe(
      '{"encrypted_content":null}',
    )
    expect(redactProviderOpaqueContent('{"signature":"signature-1"}')).toBe('{"signature":null}')
  })
})
