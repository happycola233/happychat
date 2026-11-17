import { extname } from 'node:path'

/** 落盘前的上传内容；可选的上传转换（图片压缩、文档转 PDF）以它为输入输出。 */
export interface UploadContent {
  buffer: Buffer
  filename: string
  mime: string
}

/** 替换扩展名并保留文件名主体，如 `报告.docx` → `报告.pdf`。 */
export function withFileExtension(filename: string, extension: string): string {
  const current = extname(filename)
  return `${current ? filename.slice(0, -current.length) : filename}${extension}`
}
