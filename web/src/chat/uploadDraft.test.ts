import { describe, expect, it } from 'vitest'
import type { AttachmentDTO } from '@shared/types/api'
import {
  completedUploadAttachments,
  createUploadDraft,
  failUploadDraft,
  fileTypeLabel,
  finishUploadDraft,
  formatByteSize,
  hasActiveUpload,
  hasFailedUpload,
  removeUploadDraft,
  restartUploadDraft,
  setUploadDraftProgress,
} from './uploadDraft'

const imageFile = new File([new Uint8Array(16)], 'photo.png', { type: 'image/png' })
const textFile = new File(['hello world'], 'notes.txt', { type: 'text/plain' })

const attachment: AttachmentDTO = {
  id: 'att-1',
  kind: 'image',
  filename: 'photo.png',
  mime: 'image/png',
  byteSize: 16,
}

describe('createUploadDraft', () => {
  it('图片文件立即生成 uploading 态的图片草稿', () => {
    const item = createUploadDraft({ localId: 'u1', file: imageFile, previewUrl: 'blob:x' })
    expect(item).toMatchObject({
      localId: 'u1',
      kind: 'image',
      filename: 'photo.png',
      byteSize: 16,
      previewUrl: 'blob:x',
      status: 'uploading',
      progress: 0,
      attachment: null,
    })
  })

  it('非图片 MIME 归为 file', () => {
    const item = createUploadDraft({ localId: 'u2', file: textFile, previewUrl: null })
    expect(item.kind).toBe('file')
    expect(item.previewUrl).toBeNull()
  })
})

describe('上传状态流转', () => {
  const base = [createUploadDraft({ localId: 'u1', file: imageFile, previewUrl: 'blob:x' })]

  it('进度单调递增并封顶到 1', () => {
    let items = setUploadDraftProgress(base, 'u1', 0.4)
    expect(items[0]?.progress).toBe(0.4)
    items = setUploadDraftProgress(items, 'u1', 0.2)
    expect(items[0]?.progress).toBe(0.4)
    items = setUploadDraftProgress(items, 'u1', 1.5)
    expect(items[0]?.progress).toBe(1)
  })

  it('完成后迟到的进度事件不再改动条目', () => {
    let items = finishUploadDraft(base, 'u1', attachment)
    items = setUploadDraftProgress(items, 'u1', 0.1)
    expect(items[0]).toMatchObject({ status: 'done', progress: 1, attachment })
  })

  it('失败记录错误信息，重试回到 uploading 起点', () => {
    let items = failUploadDraft(base, 'u1', '网络错误')
    expect(items[0]).toMatchObject({ status: 'error', errorMessage: '网络错误' })
    expect(hasFailedUpload(items)).toBe(true)
    items = restartUploadDraft(items, 'u1')
    expect(items[0]).toMatchObject({ status: 'uploading', progress: 0, errorMessage: null })
  })

  it('restart 不影响非失败项', () => {
    const items = restartUploadDraft(finishUploadDraft(base, 'u1', attachment), 'u1')
    expect(items[0]?.status).toBe('done')
  })

  it('remove 精确移除对应项', () => {
    const two = [
      ...base,
      createUploadDraft({ localId: 'u2', file: textFile, previewUrl: null }),
    ]
    const items = removeUploadDraft(two, 'u1')
    expect(items.map((i) => i.localId)).toEqual(['u2'])
  })
})

describe('汇总查询', () => {
  it('completedUploadAttachments 只取 done 项并保持顺序', () => {
    let items = [
      createUploadDraft({ localId: 'u1', file: imageFile, previewUrl: null }),
      createUploadDraft({ localId: 'u2', file: textFile, previewUrl: null }),
    ]
    expect(completedUploadAttachments(items)).toEqual([])
    items = finishUploadDraft(items, 'u2', { ...attachment, id: 'att-2' })
    items = finishUploadDraft(items, 'u1', attachment)
    expect(completedUploadAttachments(items).map((a) => a.id)).toEqual(['att-1', 'att-2'])
  })

  it('hasActiveUpload 只看 uploading 态', () => {
    let items = [createUploadDraft({ localId: 'u1', file: imageFile, previewUrl: null })]
    expect(hasActiveUpload(items)).toBe(true)
    items = failUploadDraft(items, 'u1', 'x')
    expect(hasActiveUpload(items)).toBe(false)
  })
})

describe('展示辅助', () => {
  it('formatByteSize 覆盖 B/KB/MB 与非法输入', () => {
    expect(formatByteSize(null)).toBe('')
    expect(formatByteSize(-1)).toBe('')
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(2048)).toBe('2 KB')
    expect(formatByteSize(3.25 * 1024 * 1024)).toBe('3.3 MB')
    expect(formatByteSize(200 * 1024 * 1024)).toBe('200 MB')
  })

  it('fileTypeLabel 优先扩展名，退回 MIME 子类型', () => {
    expect(fileTypeLabel('report.pdf', 'application/pdf')).toBe('PDF')
    expect(fileTypeLabel('archive.tar.gz', null)).toBe('GZ')
    expect(fileTypeLabel('README', 'text/markdown')).toBe('MARKDOWN')
    expect(fileTypeLabel('README', null)).toBe('文件')
  })
})
