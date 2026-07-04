import { useCallback, useState } from 'react'
import type { AttachmentDTO } from '@shared/types/api'
import { uploadAttachment } from '../api/attachments'
import { toast } from '../store/toast'

interface UseAttachmentUploadOptions {
  canImage?: boolean
  canFile?: boolean
  onUploaded: (attachment: AttachmentDTO) => void
}

export function useAttachmentUpload({
  canImage,
  canFile,
  onUploaded,
}: UseAttachmentUploadOptions) {
  const [uploading, setUploading] = useState(false)

  const uploadFiles = useCallback(
    async (files: File[]) => {
      let rejectedImageCapability = false
      let rejectedFileCapability = false
      const supported = files.filter((file) => {
        const isImage = file.type.startsWith('image/')
        if (isImage && !canImage) {
          rejectedImageCapability = true
          return false
        }
        if (!isImage && !canFile) {
          rejectedFileCapability = true
          return false
        }
        return true
      })

      if (rejectedImageCapability) toast.error('当前模型不支持图片输入')
      if (rejectedFileCapability) toast.error('当前模型不支持文件输入')
      if (!supported.length) return

      setUploading(true)
      try {
        for (const file of supported) {
          const attachment = await uploadAttachment(file)
          onUploaded(attachment)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败')
      } finally {
        setUploading(false)
      }
    },
    [canFile, canImage, onUploaded],
  )

  return { uploading, uploadFiles }
}
