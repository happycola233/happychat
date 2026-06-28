import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_INPUT_BYTES,
  MAX_FILE_INPUT_REQUEST_BYTES,
  fileInputMime,
  uploadMime,
} from './files'

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

  it('keeps the documented per-file and per-request limits together', () => {
    expect(MAX_FILE_INPUT_BYTES).toBe(50 * 1024 * 1024)
    expect(MAX_FILE_INPUT_REQUEST_BYTES).toBe(MAX_FILE_INPUT_BYTES)
  })
})
