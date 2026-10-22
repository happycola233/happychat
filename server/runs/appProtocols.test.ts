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
    for (const id of ['jsxgraph', 'chartjs', 'plotly', 'd3', 'katex'] as const) {
      const { packageName, version, file } = ARTIFACT_ASSETS[id]
      expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain(
        `<script src="https://cdn.jsdelivr.net/npm/${packageName}@${version}/${file}"></script>`,
      )
    }
    for (const variable of ['--hc-fg', '--hc-accent', '--hc-series-1', '--hc-series-6']) {
      expect(ARTIFACT_PROTOCOL_INSTRUCTIONS).toContain(variable)
    }
  })
})
