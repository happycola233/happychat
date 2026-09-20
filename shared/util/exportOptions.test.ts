import { describe, expect, it } from 'vitest'
import { exportOptionsSchema, type ExportOptions } from '../schemas/export'
import { EXPORT_FORMAT_CAPS, normalizeExportOptions } from './exportOptions'

function opts(partial: Partial<ExportOptions> & Pick<ExportOptions, 'format'>): ExportOptions {
  return exportOptionsSchema.parse(partial)
}

describe('normalizeExportOptions', () => {
  it('jsonl 强制关闭不支持的内容开关，embed 回退为仅文件名', () => {
    const normalized = normalizeExportOptions(
      opts({
        format: 'jsonl',
        includeReasoning: true,
        includeUsage: true,
        attachmentMode: 'embed',
      }),
    )
    expect(normalized.includeReasoning).toBe(false)
    expect(normalized.includeModel).toBe(false)
    expect(normalized.includeCitations).toBe(false)
    expect(normalized.includeSearch).toBe(false)
    expect(normalized.includeUsage).toBe(false)
    expect(normalized.attachmentMode).toBe('name')
  })

  it('chatlog-md/2 保留检索过程与逐条选择，全部分支回退为当前分支', () => {
    const normalized = normalizeExportOptions(
      opts({
        format: 'chatlog-md',
        scope: 'full',
        includeSearch: true,
        messageIds: ['m1'],
        includeUsage: true,
      }),
    )
    expect(normalized.scope).toBe('active')
    expect(normalized.includeSearch).toBe(true)
    expect(normalized.includeUsage).toBe(true)
    expect(normalized.messageIds).toEqual(['m1'])
  })

  it.each([
    { includeReasoning: false, includeSearch: true },
    { includeReasoning: true, includeSearch: false },
    { includeReasoning: false, includeSearch: false },
  ])('chatlog-md/2 分别保留思考与检索开关：%j', (toggles) => {
    expect(normalizeExportOptions(opts({ format: 'chatlog-md', ...toggles }))).toMatchObject(
      toggles,
    )
  })

  it('在 JSONL 与 chatlog-md/2 之间切换时不改写原有内容与附件偏好', () => {
    const preferences = opts({
      format: 'chatlog-md',
      includeReasoning: true,
      includeSearch: true,
      includeUsage: true,
      attachmentMode: 'embed',
      timePrecision: 'minute',
      timezone: 'Asia/Shanghai',
      messageIds: ['m1'],
    })
    const jsonl = normalizeExportOptions({ ...preferences, format: 'jsonl' })
    expect(jsonl).toMatchObject({
      includeReasoning: false,
      includeSearch: false,
      includeUsage: false,
      attachmentMode: 'name',
    })
    expect(normalizeExportOptions(preferences)).toEqual(preferences)
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
