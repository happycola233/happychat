import type { ModelTag } from '@shared/types/domain'

let nextDraftId = 0

/** 仅用于表单的稳定标识，修改文字或拖动后仍能关联同一个标签。 */
export interface ModelTagDraft extends ModelTag {
  draftId: string
}

export function createModelTagDraft(tag: ModelTag): ModelTagDraft {
  nextDraftId += 1
  return { ...tag, draftId: `model-tag-${nextDraftId}` }
}
