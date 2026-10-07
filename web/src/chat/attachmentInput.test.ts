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
