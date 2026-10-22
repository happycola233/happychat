import { describe, expect, it } from 'vitest'
import { exportOptionsSchema } from '@shared/schemas/export'
import { DEFAULT_CONTEXT_POLICY } from '@shared/util/contextPolicy'
import { buildHtml } from './html'
import type { ExportMessage, ExportSource } from './types'

const stamp = Date.parse('2026-10-22T08:00:00Z')
const options = exportOptionsSchema.parse({ format: 'html' })
const artifactText = [
  '图像如下：',
  '',
  '```artifact',
  '<title>正弦曲线</title>',
  '<div id="board" style="height:240px"></div>',
  '<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>',
  '<script>d3.select("#board")</script>',
  '```',
].join('\n')

function message(role: 'user' | 'assistant', text: string): ExportMessage {
  return {
    id: `${role}-message`,
    conversationId: 'conversation-example',
    parentId: null,
    role,
    status: 'complete',
    modelId: null,
    modelLabel: null,
    runId: null,
    createdAt: stamp,
    content: [role === 'user' ? { type: 'input_text', text } : { type: 'output_text', text }],
    processSteps: [],
    reasoningDurationMs: null,
    generationDurationMs: null,
    annotations: null,
    usage: null,
    errorMessage: null,
  }
}

function source(messages: ExportMessage[], readFiles: boolean): ExportSource {
  return {
    title: '图表导出示例',
    timezone: 'Asia/Shanghai',
    exportedAt: stamp,
    readFiles,
    conversation: {
      id: 'conversation-example',
      title: '图表导出示例',
      modelId: null,
      folderId: null,
      activeLeafId: null,
      pinnedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      contextPolicy: DEFAULT_CONTEXT_POLICY,
    },
    messages,
    activeLeafId: null,
    attachments: new Map(),
  }
}

describe('HTML export artifacts', () => {
  it('keeps the host navigation policy in the file head for previews and offline exports', () => {
    for (const readFiles of [false, true]) {
      const html = buildHtml(source([message('assistant', artifactText)], readFiles), options)
      const head = html.slice(0, html.indexOf('</head>'))
      expect(head).toContain(
        '<meta http-equiv="Content-Security-Policy" content="frame-src \'self\'">',
      )
    }
  })

  it('runs answer charts in a sandboxed frame with bundled libraries inlined', () => {
    const html = buildHtml(source([message('assistant', artifactText)], true), options)
    const frame = /<iframe[^>]*>/.exec(html)?.[0] ?? ''
    expect(frame).toContain('sandbox="allow-scripts"')
    expect(frame).not.toContain('allow-same-origin')
    expect(frame).toContain('title="正弦曲线"')
    expect(html).toContain('<figcaption>正弦曲线</figcaption>')
    // srcdoc 经过属性转义：沙箱文档的 CSP 与内联的 D3 都在其中，外链已被替换。
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('d3js.org')
    expect(html).not.toContain('cdn.jsdelivr.net/npm/d3')
    expect(html).toContain(`addEventListener('message'`)
  })

  it('keeps library placeholders in previews and leaves user-written fences as code', () => {
    const preview = buildHtml(source([message('assistant', artifactText)], false), options)
    expect(preview).toContain('/* d3@7.9.0 */')
    expect(preview).not.toContain('d3js.org')

    const userOnly = buildHtml(source([message('user', artifactText)], true), options)
    expect(userOnly).not.toContain('<iframe')
    expect(userOnly).toContain('language-artifact')
    expect(userOnly).not.toContain(`addEventListener('message'`)
  })
})
