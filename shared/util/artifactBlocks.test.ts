import { describe, expect, it } from 'vitest'
import {
  artifactLabel,
  artifactTitle,
  isArtifactLanguage,
  isClosedArtifactFence,
  replaceArtifactBlocks,
  summarizeArtifactBlocks,
} from './artifactBlocks'

describe('artifact title', () => {
  it('reads the title element, decodes basic entities and collapses whitespace', () => {
    expect(artifactTitle('<title>\n  正弦 &amp; 余弦\n</title><div></div>')).toBe('正弦 & 余弦')
    expect(artifactTitle('<TITLE lang="zh">函数&#x56FE;像</TITLE>')).toBe('函数图像')
    expect(artifactTitle('<svg viewBox="0 0 10 10"><title>受力分析</title></svg>')).toBe('受力分析')
  })

  it('returns null without a usable title and truncates very long ones', () => {
    expect(artifactTitle('<div>没有标题</div>')).toBeNull()
    expect(artifactTitle('<title>   </title>')).toBeNull()
    const title = artifactTitle(`<title>${'长'.repeat(80)}</title>`)
    expect(Array.from(title!)).toHaveLength(60)
    expect(title!.endsWith('…')).toBe(true)
  })

  it('labels an artifact for plain-text surfaces', () => {
    expect(artifactLabel('波形')).toBe('[Artifact：波形]')
    expect(artifactLabel(null)).toBe('[Artifact]')
  })

  it('treats artifact and svg fences as artifacts', () => {
    expect(isArtifactLanguage('artifact')).toBe(true)
    expect(isArtifactLanguage('svg')).toBe(true)
    expect(isArtifactLanguage('html')).toBe(false)
    expect(isArtifactLanguage(null)).toBe(false)
  })
})

describe('artifact block replacement', () => {
  const answer = [
    '先看图像：',
    '',
    '```artifact',
    '<title>正弦曲线</title>',
    '<script>const sentinel = 1</script>',
    '```',
    '',
    '```js',
    'console.log("kept")',
    '```',
  ].join('\n')

  it('replaces artifact blocks only and keeps other code blocks verbatim', () => {
    expect(summarizeArtifactBlocks(answer)).toBe(
      ['先看图像：', '', '[Artifact：正弦曲线]', '', '```js', 'console.log("kept")', '```'].join(
        '\n',
      ),
    )
  })

  it('also summarizes svg fences', () => {
    expect(summarizeArtifactBlocks('```svg\n<svg><title>杠杆</title></svg>\n```')).toBe(
      '[Artifact：杠杆]',
    )
  })

  it('handles tilde fences, longer closing fences and an unfinished streaming block', () => {
    expect(summarizeArtifactBlocks('~~~artifact\n<svg></svg>\n~~~~\n后文')).toBe('[Artifact]\n后文')
    expect(summarizeArtifactBlocks('正文\n```artifact\n<title>半截</title>\n<div>')).toBe(
      '正文\n[Artifact：半截]',
    )
  })

  it('does not treat an artifact fence quoted inside another code block as an artifact', () => {
    const quoted = '````markdown\n```artifact\n<div></div>\n```\n````'
    expect(summarizeArtifactBlocks(quoted)).toBe(quoted)
  })

  it('passes the raw source to the replacer', () => {
    expect(
      replaceArtifactBlocks('```artifact\r\n<p>a</p>\r\n```', (source) => source.trim()),
    ).toBe('<p>a</p>')
  })
})

describe('closed artifact fence detection', () => {
  it('detects a closed top-level artifact or svg block, including surrounding blank lines', () => {
    expect(isClosedArtifactFence('```artifact\n<div></div>\n```')).toBe(true)
    expect(isClosedArtifactFence('\n```svg\n<svg></svg>\n```\n\n')).toBe(true)
  })

  it('rejects open, non-artifact or under-length closing fences', () => {
    expect(isClosedArtifactFence('```artifact\n<div></div>')).toBe(false)
    expect(isClosedArtifactFence('```html\n<div></div>\n```')).toBe(false)
    expect(isClosedArtifactFence('````artifact\n<div></div>\n```')).toBe(false)
    expect(isClosedArtifactFence('```artifact')).toBe(false)
  })
})
