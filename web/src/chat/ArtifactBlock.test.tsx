import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ARTIFACT_FRAME_SANDBOX } from '@shared/util/artifactDocument'
import { ArtifactBlock, ArtifactFrame } from './ArtifactBlock'

describe('artifact sandbox frame', () => {
  // 安全回归：一旦加上 allow-same-origin，模型生成的脚本就能以当前用户身份调用站点接口；
  // 弹窗与对话框同样保持关闭（prompt() 可伪造输入框骗取密码）。
  it('allows scripts, downloads and form events but never same-origin access', () => {
    expect(ARTIFACT_FRAME_SANDBOX).toBe('allow-scripts allow-downloads allow-forms')
    const html = renderToStaticMarkup(<ArtifactFrame srcDoc="<p>图</p>" title="示例" />)
    expect(html).toContain('sandbox="allow-scripts allow-downloads allow-forms"')
    expect(html).not.toMatch(/allow-same-origin|allow-modals|allow-popups|allow-top-navigation/)
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
})

describe('artifact card', () => {
  const source = '<title>阻尼振荡</title>\n<canvas></canvas>\n<script>draw()</script>'

  it('numbers streamed lines by their real position, skipping blank lines', () => {
    const spaced = '<title>间隔</title>\n\n<svg>\n\n<path d="M0 0"/>'
    const html = renderToStaticMarkup(
      <ArtifactBlock source={spaced} code={<code>{spaced}</code>} complete={false} />,
    )
    expect(html).toContain('5 行')
    expect(html).toMatch(/>5<\/span>.*M0 0/)
    expect(html).not.toMatch(/>2<\/span>/)
  })

  it('streams tinted lines with line numbers, glyph, and caret until complete', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source={source} code={<code>{source}</code>} complete={false} />,
    )
    expect(html).toContain('阻尼振荡')
    expect(html).toContain('data-testid="artifact-glyph"')
    expect(html).toContain('data-phase="thinking"')
    expect(html).toContain('3 行')
    expect(html).toContain('hc-artifact-tok-tag')
    expect(html).toMatch(/draw\(\).*<span class="hc-artifact-caret">/)
    expect(html).not.toContain('查看代码')
    expect(html).not.toContain('<iframe')
  })

  it('shows shimmer status before title arrives while generating', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source="<div>" code={<code>&lt;div&gt;</code>} complete={false} />,
    )
    expect(html).toContain('hc-artifact-shimmer')
    expect(html).toContain('正在生成')
  })

  it('offers the frameless card actions once complete without mounting the glyph', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source={source} code={<code>{source}</code>} complete />,
    )
    for (const label of [
      '查看效果',
      '查看代码',
      '复制代码',
      '下载为网页文件',
      '放大查看',
      '重新运行',
    ]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).not.toContain('data-testid="artifact-glyph"')
    expect(html).not.toContain('正在生成')
    expect(html).not.toContain('<iframe')
  })

  it('falls back to a generic title when the source has none', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source="<svg></svg>" code={<code />} complete />,
    )
    expect(html).toContain('>Artifact<')
  })
})
