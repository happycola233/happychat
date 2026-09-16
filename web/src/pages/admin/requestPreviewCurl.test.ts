import { describe, expect, it } from 'vitest'
import { requestPreviewCurl } from './requestPreviewCurl'

describe('request preview curl copy', () => {
  it('quotes apostrophes and shell substitutions literally without flattening JSON', () => {
    const command = requestPreviewCurl({
      method: 'POST',
      url: 'https://example.com/v1/responses',
      headers: { authorization: 'Bearer configured-key', 'x-label': "owner's route" },
      body: { input: "It's `literal` $(data)", stream: true },
      parameters: [],
      notes: [],
    })
    expect(command).toContain("--header 'x-label: owner'\\''s route'")
    expect(command).toContain('`literal` $(data)')
    expect(command).toContain('\\\n')
    expect(command).toContain("--header 'authorization: Bearer configured-key'")
  })
})
