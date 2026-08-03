import { describe, expect, it } from 'vitest'
import { safeCitationUrl } from './citationDisplay'

describe('safeCitationUrl', () => {
  it.each(['https://example.com/a', 'http://example.com/b'])('允许网页引用 %s', (url) =>
    expect(safeCitationUrl(url)).toBe(url),
  )

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/secret', 'not a url'])(
    '拒绝不可点击的引用 %s',
    (url) => expect(safeCitationUrl(url)).toBeNull(),
  )
})
