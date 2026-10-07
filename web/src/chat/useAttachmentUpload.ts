import { useCallback, useEffect, useRef, useState } from 'react'
import { isImageMime, uploadMime } from '@shared/util/fileTypes'
import { isUploadAbortError, uploadAttachment } from '../api/attachments'
import { createRandomUuid } from '../lib/randomUuid'
import { toast } from '../store/toast'
import { attachmentInputError, type AttachmentInputSupport } from './attachmentInput'
import {
  createUploadDraft,
  failUploadDraft,
  finishUploadDraft,
  hasActiveUpload,
  hasFailedUpload,
  removeUploadDraft,
  restartUploadDraft,
  setUploadDraftProgress,
  type UploadDraftItem,
} from './uploadDraft'

/** 每个上传项的本地资源：原始 File 供重试，controller 供中止，previewUrl 供释放。 */
interface UploadTask {
  file: File
  previewUrl: string | null
  controller: AbortController | null
}

/**
 * 附件上传状态机：文件选中立刻以 uploading 项上屏（图片带本地预览），
 * 各文件并行上传、独立汇报进度；失败项可原位重试或移除。
 * 完成项留在列表里（status: done），由消费方在发送时取走并 clearUploads()。
 */
export function useAttachmentUpload({ canImage, canFile, modelKind }: AttachmentInputSupport) {
  const [uploads, setUploads] = useState<UploadDraftItem[]>([])
  const tasksRef = useRef(new Map<string, UploadTask>())

  const runUpload = useCallback((localId: string, file: File) => {
    const controller = new AbortController()
    const task = tasksRef.current.get(localId)
    if (task) task.controller = controller

    uploadAttachment(file, {
      signal: controller.signal,
      onProgress: (fraction) =>
        setUploads((items) => setUploadDraftProgress(items, localId, fraction)),
    })
      .then((attachment) => {
        setUploads((items) => finishUploadDraft(items, localId, attachment))
      })
      .catch((err: unknown) => {
        // 主动取消（移除条目/组件卸载）不是失败，静默退出。
        if (isUploadAbortError(err)) return
        const message = err instanceof Error ? err.message : '上传失败'
        toast.error(message)
        setUploads((items) => failUploadDraft(items, localId, message))
      })
  }, [])

  const uploadFiles = useCallback(
    (files: File[]) => {
      const errors = new Set<string>()
      const supported = files.filter((file) => {
        const error = attachmentInputError(
          { filename: file.name, mime: file.type },
          { canImage, canFile, modelKind },
        )
        if (error) errors.add(error)
        return !error
      })

      for (const error of errors) toast.error(error)
      if (!supported.length) return

      for (const file of supported) {
        const localId = createRandomUuid()
        const previewUrl = isImageMime(uploadMime(file.name, file.type) ?? '')
          ? URL.createObjectURL(file)
          : null
        tasksRef.current.set(localId, { file, previewUrl, controller: null })
        setUploads((items) => [...items, createUploadDraft({ localId, file, previewUrl })])
        runUpload(localId, file)
      }
    },
    [canFile, canImage, modelKind, runUpload],
  )

  const removeUpload = useCallback((localId: string) => {
    const task = tasksRef.current.get(localId)
    task?.controller?.abort()
    if (task?.previewUrl) URL.revokeObjectURL(task.previewUrl)
    tasksRef.current.delete(localId)
    setUploads((items) => removeUploadDraft(items, localId))
  }, [])

  const retryUpload = useCallback(
    (localId: string) => {
      const task = tasksRef.current.get(localId)
      if (!task) return
      const error = attachmentInputError(
        { filename: task.file.name, mime: task.file.type },
        { canImage, canFile, modelKind },
      )
      if (error) {
        toast.error(error)
        return
      }
      setUploads((items) => restartUploadDraft(items, localId))
      runUpload(localId, task.file)
    },
    [canImage, canFile, modelKind, runUpload],
  )

  /** 发送成功后清空列表（正常路径此刻全部 done，中止/释放只是兜底）。 */
  const clearUploads = useCallback(() => {
    for (const task of tasksRef.current.values()) {
      task.controller?.abort()
      if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
    }
    tasksRef.current.clear()
    setUploads([])
  }, [])

  // 卸载时中止在途请求并释放本地预览 URL。
  useEffect(() => {
    const tasks = tasksRef.current
    return () => {
      for (const task of tasks.values()) {
        task.controller?.abort()
        if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
      }
      tasks.clear()
    }
  }, [])

  return {
    uploads,
    uploadFiles,
    removeUpload,
    retryUpload,
    clearUploads,
    uploading: hasActiveUpload(uploads),
    hasFailed: hasFailedUpload(uploads),
  }
}
