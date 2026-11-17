import { describe, expect, it } from 'vitest'
import { attachmentInputError, type AttachmentInputSupport } from './attachmentInput'

const anthropic: AttachmentInputSupport = { canImage: true, canFile: true, modelKind: 'anthropic' }

describe('attachment input validation', () => {
  it('rejects Office input before upload even when the browser reports a generic or text MIME', () => {
    for (const mime of ['', 'application/octet-stream', 'text/plain']) {
      expect(attachmentInputError({ filename: 'report.DOCX', mime }, anthropic)).toContain(
        'PDF 与纯文本',
      )
    }
  })

  it('filters a mixed selection without discarding supported files', () => {
    const files = ['notes.md', 'report.docx', 'table.csv', 'report.pdf', 'archive.zip']
    expect(
      files.filter((filename) => !attachmentInputError({ filename, mime: '' }, anthropic)),
    ).toEqual(['notes.md', 'table.csv', 'report.pdf'])
  })

  it('开启转 PDF 时允许上传 Word / PowerPoint，表格与已上传的原格式附件仍拦下', () => {
    const converting = { ...anthropic, convertsOfficeToPdf: true }
    for (const filename of ['report.doc', 'report.DOCX', 'slides.ppt', 'slides.pptx']) {
      expect(attachmentInputError({ filename, mime: '' }, converting)).toBeNull()
    }
    expect(attachmentInputError({ filename: 'sheet.xlsx', mime: '' }, converting)).toContain(
      'PDF 与纯文本',
    )
    // 发送前校验不传 convertsOfficeToPdf：转换失败而保留的原格式附件不能发给 Anthropic。
    expect(
      attachmentInputError({ filename: 'report.docx', mime: '', kind: 'file' }, anthropic),
    ).toContain('PDF 与纯文本')
  })

  it('uses the current protocol when validating a retained draft or retry', () => {
    const file = { filename: 'report.docx', mime: null, kind: 'file' as const }
    expect(attachmentInputError(file, { ...anthropic, modelKind: 'responses' })).toBeNull()
    expect(attachmentInputError(file, anthropic)).toContain('PDF 与纯文本')
  })

  it('recognizes images with missing MIME and respects image capability', () => {
    const image = { filename: 'photo.PNG', mime: '' }
    expect(attachmentInputError(image, anthropic)).toBeNull()
    expect(attachmentInputError(image, { ...anthropic, canImage: false })).toContain(
      '不支持图片输入',
    )
    expect(
      attachmentInputError({ filename: 'vector.svg', mime: 'image/svg+xml' }, anthropic),
    ).toContain('图片格式不支持')
  })

  it('allows retained images without metadata but still checks capability', () => {
    const image = { filename: '图片', mime: null, kind: 'image' as const }
    expect(attachmentInputError(image, anthropic)).toBeNull()
    expect(attachmentInputError(image, { ...anthropic, canImage: false })).toContain(
      '不支持图片输入',
    )
  })

  it('checks file capability and rejects unknown formats for OpenAI too', () => {
    expect(
      attachmentInputError({ filename: 'report.pdf', mime: '' }, { ...anthropic, canFile: false }),
    ).toContain('不支持文件输入')
    expect(
      attachmentInputError(
        { filename: 'archive.zip', mime: '' },
        { ...anthropic, modelKind: 'responses' },
      ),
    ).toContain('文件格式不支持')
  })
})
