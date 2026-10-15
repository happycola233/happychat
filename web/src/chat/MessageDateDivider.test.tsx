import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageDateDivider } from './MessageDateDivider'

describe('MessageDateDivider', () => {
  it('首条消息与跨日消息显示日期，同一天内不重复显示', () => {
    const timestamp = new Date(2026, 9, 16, 12).getTime()
    expect(renderToStaticMarkup(<MessageDateDivider timestamp={timestamp} />)).toContain(
      '2026年10月16日',
    )
    expect(
      renderToStaticMarkup(
        <MessageDateDivider
          timestamp={timestamp}
          previousTimestamp={new Date(2026, 9, 16, 8).getTime()}
        />,
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        <MessageDateDivider
          timestamp={timestamp}
          previousTimestamp={new Date(2026, 9, 17, 8).getTime()}
        />,
      ),
    ).toContain('2026年10月16日')
  })
})
