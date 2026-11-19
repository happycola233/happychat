import { describe, expect, it } from 'vitest'
import { ARTIFACT_ASSETS } from '@shared/util/artifactLibraries'
import { appendAppProtocols } from './appProtocols'
import { RUNTIME_CONTEXT_INSTRUCTIONS } from './runtimeContext'
import { ARTIFACT_PROTOCOL_INSTRUCTIONS } from './artifactProtocol'

describe('app protocols', () => {
  it('appends stable protocol blocks after the model instructions in a fixed order', () => {
    expect(appendAppProtocols('Be helpful.', { artifacts: false })).toBe(
      `Be helpful.\n\n${RUNTIME_CONTEXT_INSTRUCTIONS}`,
    )
    expect(appendAppProtocols(null, { artifacts: false })).toBe(RUNTIME_CONTEXT_INSTRUCTIONS)
    expect(appendAppProtocols('Be helpful.', { artifacts: true })).toBe(
      `Be helpful.\n\n${RUNTIME_CONTEXT_INSTRUCTIONS}\n\n${ARTIFACT_PROTOCOL_INSTRUCTIONS}`,
    )
  })

  it('describes the exact contract the sandbox renderer implements', () => {
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toMatch(
      /^<artifact_protocol>\n[\s\S]*\n<\/artifact_protocol>$/,
    )
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain('fenced code block tagged `artifact`')
    for (const id of [
      'jsxgraph',
      'chartjs',
      'plotly',
      'd3',
      'katex',
      'docx',
      'pptxgenjs',
      'jszip',
    ] as const) {
      const { packageName, version, file } = ARTIFACT_ASSETS[id]
      expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain(
        `<script src="https://cdn.jsdelivr.net/npm/${packageName}@${version}/${file}"></script>`,
      )
    }
    // SheetJS 新版不在 npm 发布，提示词给出官方 CDN 地址。
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain(
      `<script src="https://cdn.sheetjs.com/xlsx-${ARTIFACT_ASSETS.xlsx.version}/package/dist/xlsx.full.min.js"></script>`,
    )
    for (const variable of ['--hc-fg', '--hc-accent', '--hc-series-1', '--hc-series-6']) {
      expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain(variable)
    }
    // 与沙箱权限、主题判定一致：允许下载与表单事件，自定义颜色用 light-dark() 适配明暗。
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain('<a download=')
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain('event.preventDefault()')
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain('light-dark(')
    expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain('.colorScheme')
  })
})
