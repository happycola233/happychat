import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ARTIFACT_FRAME_SANDBOX, ArtifactBlock, ArtifactFrame } from './ArtifactBlock'

describe('artifact sandbox frame', () => {
  // 安全回归：一旦加上 allow-same-origin，模型生成的脚本就能以当前用户身份调用站点接口。
  it('only allows scripts and never grants same-origin access', () => {
    expect(ARTIFACT_FRAME_SANDBOX).toBe('allow-scripts')
    const html = renderToStaticMarkup(<ArtifactFrame srcDoc="<p>图</p>" title="示例" />)
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
})

describe('artifact card', () => {
  const source = '<title>阻尼振荡</title>\n<canvas></canvas>\n<script>draw()</script>'

  it('streams the recent lines with a caret on the current one until the block is complete', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source={source} code={<code>{source}</code>} complete={false} />,
    )
    expect(html).toContain('阻尼振荡')
    expect(html).toContain('正在生成 · 3 行')
    expect(html).toContain('&lt;canvas&gt;&lt;/canvas&gt;')
    expect(html).toMatch(/&lt;script&gt;draw\(\)&lt;\/script&gt;<span class="hc-artifact-caret">/)
    expect(html).not.toContain('查看代码')
    expect(html).not.toContain('<iframe')
  })

  it('offers the card actions once complete without executing anything during render', () => {
    const html = renderToStaticMarkup(
      <ArtifactBlock source={source} code={<code>{source}</code>} complete />,
    )
    for (const label of ['查看代码', '复制代码', '下载为网页文件', '放大查看', '重新运行']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
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
