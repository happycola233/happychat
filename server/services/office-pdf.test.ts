import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertOfficeToPdf, libreOfficeVersion } from './office-pdf'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** 最小可用的合成 docx：只有一段文字，不含任何真实文档内容。 */
function syntheticDocx(): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成测试文档 Synthetic document</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
  )
}

// 真实转换依赖本机 LibreOffice；未安装的环境只跳过这两项，其余用例照常运行。
const installedVersion = await libreOfficeVersion()

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('convertOfficeToPdf', () => {
  it('找不到 LibreOffice 时保留原文件，不阻断上传', async () => {
    vi.stubEnv('LIBREOFFICE_PATH', 'missing-libreoffice-for-test')
    vi.resetModules()
    const isolated = await import('./office-pdf')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const upload = { buffer: syntheticDocx(), filename: '报告.docx', mime: DOCX_MIME }
    expect(await isolated.convertOfficeToPdf(upload)).toBe(upload)
    expect(await isolated.libreOfficeVersion()).toBeNull()
  })

  it('非 Word / PowerPoint 文件直接返回原对象', async () => {
    const upload = { buffer: Buffer.from('a,b'), filename: 'data.csv', mime: 'text/csv' }
    expect(await convertOfficeToPdf(upload)).toBe(upload)
  })

  it.skipIf(!installedVersion)(
    '转换为 PDF 并沿用原文件名主体',
    async () => {
      const converted = await convertOfficeToPdf({
        buffer: syntheticDocx(),
        filename: '季度 报告.final.docx',
        mime: DOCX_MIME,
      })
      expect(converted).toMatchObject({ filename: '季度 报告.final.pdf', mime: 'application/pdf' })
      expect(converted.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    },
    120_000,
  )

  it.skipIf(!installedVersion)(
    '按内容识别格式：扩展名为 .doc 的 RTF 也能转换',
    async () => {
      const converted = await convertOfficeToPdf({
        buffer: Buffer.from('{\\rtf1\\ansi Synthetic RTF document\\par}'),
        filename: 'legacy.doc',
        mime: 'application/msword',
      })
      expect(converted).toMatchObject({ filename: 'legacy.pdf', mime: 'application/pdf' })
      expect(converted.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    },
    120_000,
  )
})
