import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8')

function ruleBody(selector: string): string {
  const marker = `${selector} {`
  const ruleStart = css.indexOf(marker)
  expect(ruleStart, `缺少 CSS 规则 ${selector}`).toBeGreaterThanOrEqual(0)
  const bodyStart = ruleStart + marker.length
  const bodyEnd = css.indexOf('}', bodyStart)
  expect(bodyEnd, `CSS 规则 ${selector} 未闭合`).toBeGreaterThan(bodyStart)
  return css.slice(bodyStart, bodyEnd)
}

describe('bare folder and model-group glyph styles', () => {
  it.each(['.hc-colored-glyph', '.dark .hc-colored-glyph'])(
    '%s only sets the foreground color',
    (selector) => {
      const declarations = ruleBody(selector)

      expect(declarations).toMatch(/\bcolor\s*:/)
      expect(declarations).not.toMatch(
        /\b(?:background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|box-shadow|outline(?:-[a-z-]+)?)\s*:/,
      )
    },
  )

  it('keeps folder colors exact in light mode and readable in dark mode', () => {
    expect(ruleBody('.hc-colored-glyph')).toContain('color: var(--hc-glyph-color)')
    expect(ruleBody('.dark .hc-colored-glyph')).toContain(
      'color: color-mix(in srgb, var(--hc-glyph-color) 78%, white)',
    )
    expect(css).not.toContain('hc-contrasted-glyph')
  })
})
