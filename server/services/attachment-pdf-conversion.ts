import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { attachments } from '../db/schema'
import type { UploadContent } from '../lib/upload-content'
import { removeUpload, saveUpload, sha256 } from '../storage/files'
import { convertOfficeToPdf } from './office-pdf'

/**
 * 正在后台转 PDF 的附件。上传先保存原文件并立即返回，用户不必等转换结束就能发送；
 * 发送时由 prepareRun 等待所引用附件的转换落盘，再按最终格式校验、写入消息并构建请求。
 * 只存在于进程内：服务重启后未完成的转换随之放弃，附件保留原格式，与转换失败的结果相同。
 */
const pendingConversions = new Map<string, Promise<void>>()

/** 已落盘的原始附件；转换成功后原地替换为 PDF。 */
interface StoredAttachment {
  id: string
  userId: string
  storagePath: string
}

async function replaceWithPdf(
  { id, userId, storagePath }: StoredAttachment,
  upload: UploadContent,
): Promise<void> {
  const pdf = await convertOfficeToPdf(upload)
  if (!pdf) return
  const pdfPath = saveUpload(userId, id, pdf.filename, pdf.mime, pdf.buffer)
  const replaced = db
    .update(attachments)
    .set({
      filename: pdf.filename,
      mime: pdf.mime,
      byteSize: pdf.buffer.length,
      storagePath: pdfPath,
      sha256: sha256(pdf.buffer),
    })
    .where(eq(attachments.id, id))
    .returning({ id: attachments.id })
    .get()
  // 替换成功后删除原文件；转换期间附件或账号已被删除时，丢弃刚写入的 PDF，不留无记录的磁盘文件。
  removeUpload(replaced ? storagePath : pdfPath)
}

export function convertAttachmentToPdfInBackground(
  attachment: StoredAttachment,
  upload: UploadContent,
): void {
  const conversion = replaceWithPdf(attachment, upload)
    .catch((error: unknown) =>
      console.error(`附件转 PDF 后替换失败，保留原文件（attachmentId=${attachment.id}）：`, error),
    )
    .finally(() => pendingConversions.delete(attachment.id))
  pendingConversions.set(attachment.id, conversion)
}

/** 等待这些附件中仍在进行的后台转换结束（成功替换或保留原文件）；没有进行中的转换时立即返回。 */
export async function waitForAttachmentPdfConversions(attachmentIds: string[]): Promise<void> {
  await Promise.all(attachmentIds.map((id) => pendingConversions.get(id)))
}
