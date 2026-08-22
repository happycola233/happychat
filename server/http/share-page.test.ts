import { describe, expect, it } from 'vitest'
import {
  buildShareDescription,
  renderSharePageHtml,
  resolvePublicRequestUrl,
  type SharePreviewData,
} from './share-page'

const INDEX_HTML = '<!doctype html><html><head><title>HappyChat</title></head><body></body></html>'

function share(overrides: Partial<SharePreviewData> = {}): SharePreviewData {
  return {
    title: '一次公开对话',
    messages: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: '第一行\n  第二行' }],
      },
    ],
    ...overrides,
  }
}

describe('share page metadata', () => {
  it('renders title, description, canonical URL and the existing app icon into the first HTML', () => {
    const html = renderSharePageHtml(
      INDEX_HTML,
      share(),
      new URL('https://chat.example.com/s/public-token'),
    )

    expect(html).toContain('<title>一次公开对话</title>')
    expect(html).toContain('<meta name="description" content="第一行 第二行" />')
    expect(html).toContain('<meta property="og:title" content="一次公开对话" />')
    expect(html).toContain(
      '<meta property="og:url" content="https://chat.example.com/s/public-token" />',
    )
    expect(html).toContain(
      '<meta property="og:image" content="https://chat.example.com/app-icon-512x512.png" />',
    )
    expect(html).toContain('<meta name="twitter:card" content="summary" />')
  })

  it('escapes dynamic values before placing them in the document head', () => {
    const html = renderSharePageHtml(
      INDEX_HTML,
      share({
        title: '<script>alert("title")</script>',
        messages: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'A "quoted" & <unsafe> description' }],
          },
        ],
      }),
      new URL('https://chat.example.com/s/token?a=ignored'),
    )

    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;')
    expect(html).toContain('A &quot;quoted&quot; &amp; &lt;unsafe&gt; description')
    expect(html).toContain('content="https://chat.example.com/s/token?a=ignored"')
  })

  it('prefers user text, truncates long descriptions, and falls back when the snapshot has no text', () => {
    const longText = '😊'.repeat(200)
    const description = buildShareDescription([
      { role: 'assistant', content: [{ type: 'output_text', text: '助手开场' }] },
      { role: 'user', content: [{ type: 'input_text', text: longText }] },
    ])

    expect(Array.from(description)).toHaveLength(160)
    expect(description.endsWith('…')).toBe(true)
    expect(buildShareDescription([{ role: 'user', content: [] }])).toBe(
      '来自 HappyChat 的公开对话',
    )
  })

  it('uses forwarded public origin and removes query/hash from the canonical URL', () => {
    const request = new Request('http://127.0.0.1:8787/s/token?preview=1#section', {
      headers: {
        'x-forwarded-host': 'chat.example.com',
        'x-forwarded-proto': 'https',
      },
    })

    expect(resolvePublicRequestUrl(request).href).toBe('https://chat.example.com/s/token')
  })
})
