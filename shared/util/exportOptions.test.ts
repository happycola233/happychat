import { describe, expect, it } from 'vitest'
import { exportOptionsSchema, type ExportOptions } from '../schemas/export'
import { EXPORT_FORMAT_CAPS, normalizeExportOptions } from './exportOptions'

function opts(partial: Partial<ExportOptions> & Pick<ExportOptions, 'format'>): ExportOptions {
  return exportOptionsSchema.parse(partial)
}

describe('normalizeExportOptions', () => {
  it('jsonl 强制关闭不支持的内容开关，embed 回退为仅文件名', () => {
    const normalized = normalizeExportOptions(
      opts({ format: 'jsonl', includeReasoning: true, includeUsage: true, attachmentMode: 'embed' }),
    )
    expect(normalized.includeReasoning).toBe(false)
    expect(normalized.includeModel).toBe(false)
    expect(normalized.includeCitations).toBe(false)
    expect(normalized.includeWebSearch).toBe(false)
    expect(normalized.includeUsage).toBe(false)
    expect(normalized.attachmentMode).toBe('name')
  })

  it('chatlog-md 不支持联网搜索过程与全部分支，其余保留', () => {
    const normalized = normalizeExportOptions(
      opts({
        format: 'chatlog-md',
        scope: 'full',
        includeWebSearch: true,
        messageIds: ['m1'],
        includeUsage: true,
      }),
    )
    expect(normalized.scope).toBe('active')
    expect(normalized.includeWebSearch).toBe(false)
    expect(normalized.includeUsage).toBe(true)
    expect(normalized.messageIds).toEqual(['m1'])
  })

  it('json 保留全部分支范围，且全树导出时忽略逐条选择', () => {
    const normalized = normalizeExportOptions(
      opts({ format: 'json', scope: 'full', messageIds: ['m1'] }),
    )
    expect(normalized.scope).toBe('full')
    expect(normalized.messageIds).toBeNull()
  })

  it('每种格式的回退附件模式都是其能力矩阵的首项', () => {
    for (const [format, caps] of Object.entries(EXPORT_FORMAT_CAPS)) {
      const normalized = normalizeExportOptions(
        opts({ format: format as ExportOptions['format'], attachmentMode: 'embed' }),
      )
      expect(caps.attachmentModes).toContain(normalized.attachmentMode)
    }
  })
})
