import { describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '../provider/errors'
import type { StreamEvent } from '../provider/sse-parse'
import {
  buildFallbackResponseBody,
  classifyResponseStreamFallback,
  streamResponseWithFallback,
} from './response-stream-fallback'

function upstreamError(options: {
  status?: number
  type?: string
  code?: string
  rawMessage?: string
}): UpstreamError {
  return new UpstreamError({
    message: '请求参数有误：本地化后的文案不应参与判定',
    status: options.status ?? 400,
    type: options.type,
    code: options.code,
    rawMessage: options.rawMessage,
  })
}

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('Responses stream fallback', () => {
  it('recognizes unsupported include from raw upstream fields and removes include', () => {
    const error = upstreamError({
      type: 'invalid_request_error',
      code: 'unknown_parameter',
      rawMessage: "Unknown parameter: 'include'.",
    })
    const body = { model: 'gpt-test', include: ['reasoning.encrypted_content'], input: [] }

    expect(classifyResponseStreamFallback(error)).toBe('unsupported_include')
    expect(buildFallbackResponseBody(body, 'unsupported_include')).toEqual({
      model: 'gpt-test',
      input: [],
    })
    expect(body).toHaveProperty('include')
  })

  it('recognizes an invalid encrypted reasoning item and removes every reasoning item', () => {
    const error = upstreamError({
      type: 'invalid_request_error',
      code: 'invalid_value',
      rawMessage: 'The encrypted_content in this reasoning item could not be decrypted.',
    })
    const body = {
      input: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'cipher-1' },
        { type: 'message', role: 'assistant', content: [] },
        { type: 'reasoning', id: 'rs_2', encrypted_content: 'cipher-2' },
      ],
    }

    expect(classifyResponseStreamFallback(error)).toBe('invalid_reasoning_context')
    expect(buildFallbackResponseBody(body, 'invalid_reasoning_context')).toEqual({
      input: [{ type: 'message', role: 'assistant', content: [] }],
    })
    expect(body.input).toHaveLength(3)
  })

  it.each(['invalid_reasoning_item', 'invalid_encrypted_content'])(
    'recognizes a code-only %s error after normalizing separators',
    (code) => {
      expect(classifyResponseStreamFallback(upstreamError({ code }))).toBe(
        'invalid_reasoning_context',
      )
    },
  )

  it('recognizes a code-only unsupported encrypted-content include', () => {
    expect(
      classifyResponseStreamFallback(
        upstreamError({ code: 'unsupported_reasoning_encrypted_content' }),
      ),
    ).toBe('unsupported_include')
  })

  it.each([
    'Invalid reasoning effort: ultra',
    'Invalid reasoning.context parameter: all_turns',
    'Invalid reasoning summary option',
  ])('does not mistake another reasoning parameter error for bad history: %s', (rawMessage) => {
    expect(
      classifyResponseStreamFallback(
        upstreamError({ type: 'invalid_request_error', code: 'invalid_value', rawMessage }),
      ),
    ).toBeNull()
  })

  it('retries once before the first upstream event', async () => {
    const attemptedBodies: Record<string, unknown>[] = []
    const fallback = vi.fn()
    const openStream = (body: Record<string, unknown>): AsyncIterable<StreamEvent> => {
      attemptedBodies.push(body)
      return (async function* () {
        if (attemptedBodies.length === 1) {
          throw upstreamError({
            type: 'invalid_request_error',
            code: 'unknown_parameter',
            rawMessage: 'Unknown parameter include',
          })
        }
        yield { type: 'response.completed', data: {} }
      })()
    }

    const events = await collect(
      streamResponseWithFallback({
        body: { input: [], include: ['reasoning.encrypted_content'] },
        openStream,
        onFallback: fallback,
      }),
    )

    expect(events).toEqual([{ type: 'response.completed', data: {} }])
    expect(attemptedBodies).toHaveLength(2)
    expect(attemptedBodies[1]).not.toHaveProperty('include')
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('never retries after any upstream event has arrived', async () => {
    const openStream = vi.fn(() =>
      (async function* () {
        yield { type: 'response.output_text.delta', data: { delta: 'first' } }
        throw upstreamError({
          type: 'invalid_request_error',
          code: 'unknown_parameter',
          rawMessage: 'Unknown parameter include',
        })
      })(),
    )

    await expect(
      collect(
        streamResponseWithFallback({
          body: { input: [], include: ['reasoning.encrypted_content'] },
          openStream,
        }),
      ),
    ).rejects.toBeInstanceOf(UpstreamError)
    expect(openStream).toHaveBeenCalledOnce()
  })

  it('does not retry 5xx or repeat a failed downgrade attempt', async () => {
    expect(
      classifyResponseStreamFallback(
        upstreamError({
          status: 503,
          code: 'unknown_parameter',
          rawMessage: 'Unknown parameter include',
        }),
      ),
    ).toBeNull()

    const openStream = vi.fn(
      (): AsyncIterable<StreamEvent> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw upstreamError({
              code: 'unknown_parameter',
              rawMessage: 'Unknown parameter include',
            })
          },
        }),
      }),
    )
    await expect(
      collect(
        streamResponseWithFallback({
          body: { input: [], include: ['reasoning.encrypted_content'] },
          openStream,
        }),
      ),
    ).rejects.toBeInstanceOf(UpstreamError)
    expect(openStream).toHaveBeenCalledTimes(2)
  })
})
