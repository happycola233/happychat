import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../chat/Markdown'

const markup =
  '<img src="https://example.com/image.png" width="480" height="270" alt="图片说明" data-crop="10,20,80,45" onerror="alert(1)" style="position:fixed">'

describe('announcement image rendering', () => {
  it('preserves width and non-destructive crop only for announcements', () => {
    const html = renderToStaticMarkup(<Markdown text={markup} announcementImages />)
    expect(html).toContain('aspect-ratio:480 / 270')
    expect(html).toContain('width:125%')
    expect(html).toContain('left:-12.5%')
    expect(html).toContain('alt="图片说明"')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('position:fixed')
    const chat = renderToStaticMarkup(<Markdown text={markup} />)
    expect(chat).not.toContain('hc-announcement-image')
    expect(chat).not.toContain('data-crop')
  })

  it('keeps ordinary external markdown images and rejects unsafe URLs/crop values', () => {
    expect(
      renderToStaticMarkup(
        <Markdown text="![外部图片](https://example.com/a.png)" announcementImages />,
      ),
    ).toContain('src="https://example.com/a.png"')
    const html = renderToStaticMarkup(
      <Markdown
        text='<img src="javascript:alert(1)" width="480" height="270" data-crop="0,0,0,100">'
        announcementImages
      />,
    )
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('aspect-ratio')
    expect(html).not.toContain('Infinity')
  })
})
