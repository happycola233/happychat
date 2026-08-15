import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RequestOutcomeBadge } from './RequestOutcomeBadge'

describe('RequestOutcomeBadge', () => {
  it('把结果标签渲染为可聚焦、可展开的说明按钮', () => {
    const html = renderToStaticMarkup(
      <RequestOutcomeBadge kind="chat" result="filtered" terminalReason="content_filter" />,
    )

    expect(html).toContain('<button')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('内容过滤')
    expect(html).toContain('查看请求结果说明')
  })
})
