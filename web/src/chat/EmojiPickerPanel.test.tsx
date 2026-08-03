import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import EmojiPickerPanel from './EmojiPickerPanel'

describe('EmojiPickerPanel', () => {
  it('让内嵌选择器沿用宿主的弱化表面色', () => {
    const html = renderToStaticMarkup(
      <EmojiPickerPanel autoFocusSearch={false} surface="muted" onSelect={vi.fn()} />,
    )

    expect(html).toContain('[--hc-emoji-surface:var(--color-neutral-50)]')
    expect(html).toContain('dark:[--hc-emoji-surface:var(--color-neutral-900)]')
    expect(html).toContain('bg-[var(--hc-emoji-surface)]')
  })

  it('独立面板默认使用基础表面色', () => {
    const html = renderToStaticMarkup(
      <EmojiPickerPanel autoFocusSearch={false} onSelect={vi.fn()} />,
    )

    expect(html).toContain('[--hc-emoji-surface:white]')
  })
})
