import { describe, expect, it } from 'vitest'
import type { ContentPart } from '@shared/types/domain'
import {
  attachmentDraftFromAttachment,
  attachmentDraftsFromContent,
  canSubmitAttachmentDraft,
  getAttachmentDraftSupportIssue,
  removeAttachmentDraft,
  toAttachmentRefs,
} from './attachmentDraft'

describe('attachment draft helpers', () => {
  it('extracts editable image and file drafts from message content', () => {
    const content: ContentPart[] = [
      { type: 'input_text', text: '看一下这些材料' },
      { type: 'input_image', attachment_id: 'image-1', detail: 'high' },
      { type: 'input_file', attachment_id: 'file-1', filename: 'notes.pdf' },
    ]

    expect(attachmentDraftsFromContent(content)).toEqual([
      {
        draftId: 'retained-image-image-1-1',
        attachmentId: 'image-1',
        kind: 'image',
        filename: '图片',
        byteSize: null,
        mime: null,
        detail: 'high',
        retained: true,
      },
      {
        draftId: 'retained-file-file-1-2',
        attachmentId: 'file-1',
        kind: 'file',
        filename: 'notes.pdf',
        byteSize: null,
        mime: null,
        retained: true,
      },
    ])
  })

  it('maps retained and newly uploaded drafts to the run attachments payload', () => {
    const retained = attachmentDraftsFromContent([
      { type: 'input_image', attachment_id: 'image-1', detail: 'low' },
      { type: 'input_file', attachment_id: 'file-1', filename: 'old.txt' },
    ])
    const uploaded = attachmentDraftFromAttachment({
      id: 'file-2',
      kind: 'file',
      filename: 'new.txt',
      mime: 'text/plain',
      byteSize: 12,
    })
    const next = [...removeAttachmentDraft(retained, retained[1]!.draftId), uploaded]

    expect(toAttachmentRefs(next)).toEqual([
      { attachmentId: 'image-1', kind: 'image', filename: '图片', detail: 'low' },
      { attachmentId: 'file-2', kind: 'file', filename: 'new.txt', detail: undefined },
    ])
  })

  it('allows attachment-only edits and reports unsupported attachment kinds', () => {
    const drafts = attachmentDraftsFromContent([
      { type: 'input_image', attachment_id: 'image-1' },
      { type: 'input_file', attachment_id: 'file-1', filename: 'report.pdf' },
    ])

    expect(canSubmitAttachmentDraft('', drafts)).toBe(true)
    expect(canSubmitAttachmentDraft('   ', [])).toBe(false)
    expect(getAttachmentDraftSupportIssue(drafts, { canImage: false, canFile: true })).toBe(
      'image',
    )
    expect(getAttachmentDraftSupportIssue(drafts, { canImage: true, canFile: false })).toBe(
      'file',
    )
    expect(getAttachmentDraftSupportIssue(drafts, { canImage: true, canFile: true })).toBeNull()
  })
})
