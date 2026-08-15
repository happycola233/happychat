import { describe, expect, it } from 'vitest'
import { errorTypeForAudit, terminalReasonForUsage } from './usage-audit'

describe('terminalReasonForUsage', () => {
  it('preserves lifecycle reasons without changing the legacy success meaning', () => {
    expect(terminalReasonForUsage('completed')).toBeNull()
    expect(terminalReasonForUsage('incomplete', { incompleteReason: 'max_output_tokens' })).toBe(
      'max_output_tokens',
    )
    expect(terminalReasonForUsage('canceled')).toBe('user_cancelled')
    expect(terminalReasonForUsage('interrupted')).toBe('server_restart')
  })

  it('keeps refusal and filtering visible even when another upstream code is present', () => {
    expect(
      terminalReasonForUsage('failed', { errorType: 'refusal', errorCode: 'request_rejected' }),
    ).toBe('refusal')
    expect(
      terminalReasonForUsage('failed', {
        errorType: 'response_failed',
        errorCode: 'content_filter',
      }),
    ).toBe('content_filter')
    expect(
      terminalReasonForUsage('failed', { errorType: 'api_error', errorCode: 'server_error' }),
    ).toBe('server_error')
  })

  it('uses a concrete code when the upstream omits its error type', () => {
    expect(errorTypeForAudit(null, 'rate_limit_exceeded')).toBe('rate_limit_exceeded')
    expect(errorTypeForAudit('response_error', 'stream_failed')).toBe('response_error')
    expect(errorTypeForAudit(null, null)).toBe('error')
  })
})
