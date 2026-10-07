import { describe, expect, it } from 'vitest'
import { fileInputMime, fileUploadAccept, isSupportedFileInputMime, uploadMime } from './fileTypes'

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

  it.each(['docx', 'xlsx', 'pptx', 'doc', 'rtf', 'odt'])(
    'rejects .%s for Anthropic only',
    (ext) => {
      const mime = fileInputMime(`example.${ext}`, 'application/octet-stream')
      expect(isSupportedFileInputMime(mime, 'anthropic')).toBe(false)
      expect(isSupportedFileInputMime(mime, 'responses')).toBe(true)
      expect(isSupportedFileInputMime(mime, 'chat')).toBe(true)
    },
  )

  it.each(['pdf', 'txt', 'md', 'csv', 'tsv', 'log', 'json', 'py', 'ts'])(
    'accepts .%s for Anthropic',
    (ext) => {
      expect(isSupportedFileInputMime(fileInputMime(`example.${ext}`, ''), 'anthropic')).toBe(true)
    },
  )

  it('normalizes MIME parameters and extensionless text while excluding rich text', () => {
    expect(fileInputMime('README', 'TEXT/PLAIN; charset=utf-8')).toBe('text/plain')
    expect(isSupportedFileInputMime(fileInputMime('document', 'text/rtf'), 'anthropic')).toBe(false)
    expect(uploadMime('photo.PNG', '')).toBe('image/png')
    expect(uploadMime('photo', 'image/jpeg')).toBe('image/jpeg')
  })

  it('restricts the Anthropic picker while preserving Office formats in OpenAI pickers', () => {
    const anthropicAccept = fileUploadAccept('anthropic').split(',')
    expect(anthropicAccept).toEqual(
      expect.arrayContaining(['.pdf', '.txt', '.md', '.csv', '.json', 'text/plain']),
    )
    for (const rejected of ['.docx', '.xlsx', '.pptx', '.rtf', 'text/rtf', 'image/*']) {
      expect(anthropicAccept).not.toContain(rejected)
    }
    expect(fileUploadAccept('responses').split(',')).toContain('.docx')
    expect(fileUploadAccept('chat').split(',')).toContain('.xlsx')
  })
})
