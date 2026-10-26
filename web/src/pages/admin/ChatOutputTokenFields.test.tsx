import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatOutputTokenFields } from './ChatOutputTokenFields'

describe('Chat output token configuration', () => {
  it('shows two empty independent fields and explains the upstream compatibility difference', () => {
    const html = renderToStaticMarkup(
      <ChatOutputTokenFields params={{}} onChange={() => undefined} />,
    )
    expect(html.match(/type="number"/g)).toHaveLength(2)
    expect(html.match(/value=""/g)).toHaveLength(2)
    expect(html).toContain('max_completion_tokens')
    expect(html).toContain('max_tokens')
    expect(html).toContain('OpenAI Chat Completions 当前推荐')
    expect(html).toContain('DeepSeek 等上游仍使用')
    expect(html).toContain('OpenAI o 系列不支持')
  })
  it('keeps configured values separate', () => {
    const html = renderToStaticMarkup(
      <ChatOutputTokenFields
        params={{ max_completion_tokens: 512, max_tokens: 128 }}
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('value="512"')
    expect(html).toContain('value="128"')
  })
})
