import { describe, expect, it } from 'vitest'
import { tokenizeArtifactStreamLine } from './artifactStreamSyntax'

describe('tokenizeArtifactStreamLine', () => {
  it('classifies HTML tags, attributes, strings, and plain text without dropping characters', () => {
    const line = '<svg id="plot" viewBox="0 0 560 164">'
    const tokens = tokenizeArtifactStreamLine(line)
    expect(tokens.map((token) => token.text).join('')).toBe(line)
    expect(tokens).toEqual([
      { kind: 'tag', text: '<svg' },
      { kind: 'plain', text: ' ' },
      { kind: 'attr', text: 'id' },
      { kind: 'plain', text: '=' },
      { kind: 'string', text: '"plot"' },
      { kind: 'plain', text: ' ' },
      { kind: 'attr', text: 'viewBox' },
      { kind: 'plain', text: '=' },
      { kind: 'string', text: '"0 0 560 164"' },
      { kind: 'tag', text: '>' },
    ])
  })

  it('classifies JS keywords, numbers, CSS properties, and comments', () => {
    const js = '  const w0 = 4.2 // rad/s'
    const jsTokens = tokenizeArtifactStreamLine(js)
    expect(jsTokens.map((token) => token.text).join('')).toBe(js)
    expect(jsTokens.find((t) => t.text === 'const')?.kind).toBe('keyword')
    expect(jsTokens.find((t) => t.text === '4.2')?.kind).toBe('number')
    expect(jsTokens.find((t) => t.text === '// rad/s')?.kind).toBe('comment')

    const css = '  stroke-width: 2.2px;'
    const cssTokens = tokenizeArtifactStreamLine(css)
    expect(cssTokens.map((token) => token.text).join('')).toBe(css)
    expect(cssTokens.find((t) => t.text === 'stroke-width')?.kind).toBe('attr')
    expect(cssTokens.find((t) => t.text === '2.2px')?.kind).toBe('number')
  })

  it('keeps URLs in a string that is still streaming out of the comment color', () => {
    const line = '<script src="https://cdn.jsdelivr.net/npm/d3'
    const tokens = tokenizeArtifactStreamLine(line)
    expect(tokens.map((token) => token.text).join('')).toBe(line)
    expect(tokens.some((token) => token.kind === 'comment')).toBe(false)
    expect(tokenizeArtifactStreamLine('draw() // 重绘').at(-1)).toEqual({
      kind: 'comment',
      text: '// 重绘',
    })
  })
})
