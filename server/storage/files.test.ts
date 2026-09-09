import { describe, expect, it } from 'vitest'
import { fileInputMime, uploadMime } from './files'

describe('file input MIME normalization', () => {
  it('normalizes generic .log uploads to the supported text/plain MIME', () => {
    expect(uploadMime('diagnostic.LOG', 'application/octet-stream')).toBe('text/plain')
    expect(fileInputMime('diagnostic.log', 'application/octet-stream')).toBe('text/plain')
  })

  it('uses canonical MIME types for structured documents', () => {
    expect(uploadMime('report.pdf', '')).toBe('application/pdf')
    expect(uploadMime('sheet.xlsx', 'application/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  it('rejects file types that OpenAI input_file does not accept', () => {
    expect(uploadMime('archive.zip', 'application/octet-stream')).toBeNull()
    expect(fileInputMime('archive.zip', 'application/zip')).toBeNull()
  })
})
