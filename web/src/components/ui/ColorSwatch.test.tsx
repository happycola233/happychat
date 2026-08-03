import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ColorModeButton, ColorSwatch, CUSTOM_COLOR_SWATCH_BACKGROUND } from './ColorSwatch'

function openingTag(html: string): string {
  return html.match(/^<button\b[^>]*>/)?.[0] ?? ''
}

function classTokens(tag: string): Set<string> {
  const value = tag.match(/\bclass="([^"]*)"/)?.[1] ?? ''
  return new Set(value.split(/\s+/).filter(Boolean))
}

describe('ColorSwatch', () => {
  it('locks every gradient swatch to one borderless 28px box', () => {
    const tag = openingTag(
      renderToStaticMarkup(
        <ColorSwatch
          selected={false}
          aria-label="自定义颜色"
          style={{ background: CUSTOM_COLOR_SWATCH_BACKGROUND }}
        />,
      ),
    )

    expect(tag).toContain('h-7 w-7')
    expect(tag.replaceAll(' ', '')).toContain(CUSTOM_COLOR_SWATCH_BACKGROUND.replaceAll(' ', ''))
    expect(tag).toContain('border-width:0')
    expect(tag).toContain('background-origin:border-box')
    expect(tag).toContain('background-clip:border-box')
    expect(tag).toContain('background-repeat:no-repeat')
    expect(tag).not.toMatch(/\b(?:border-black|border-white|dark:border)/)
  })

  it('keeps selection state separate from the original swatch color', () => {
    const tag = openingTag(
      renderToStaticMarkup(
        <ColorSwatch
          selected
          aria-label="使用颜色 #ef4444"
          style={{ backgroundColor: '#ef4444' }}
        />,
      ),
    )

    expect(tag).toContain('aria-pressed="true"')
    expect(tag).toContain('background-color:#ef4444')
    expect(tag).toContain('ring-sky-500')
  })

  it('uses the model-tag panel surface for focus and selection ring offsets', () => {
    const tag = openingTag(
      renderToStaticMarkup(
        <ColorSwatch selected surface="panel" aria-label="标签颜色" />,
      ),
    )

    expect(tag).toContain('ring-offset-neutral-50')
    expect(tag).toContain('dark:ring-offset-neutral-800')
  })

  it('preserves the folder palette selection style without a permanent outer ring', () => {
    const tag = openingTag(
      renderToStaticMarkup(
        <ColorSwatch selected showSelectedRing={false} aria-label="文件夹颜色" />,
      ),
    )

    expect(tag).toContain('aria-pressed="true"')
    expect(classTokens(tag)).not.toContain('ring-sky-500')
  })
})

describe('ColorModeButton', () => {
  it('renders the selected default mode like the model-tag automatic mode', () => {
    const tag = openingTag(
      renderToStaticMarkup(
        <ColorModeButton selected aria-label="默认颜色">
          默认
        </ColorModeButton>,
      ),
    )

    expect(tag).toContain('aria-pressed="true"')
    expect(tag).toContain('border-sky-500')
    expect(tag).toContain('bg-sky-50')
    expect(tag).toContain('text-sky-600')
    expect(classTokens(tag)).not.toContain('ring-sky-500')
  })
})
