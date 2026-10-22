import { createContext } from 'react'

export interface ArtifactActions {
  /** 把修复请求填进输入框，由用户确认后发送；sourceRect 是 Artifact 卡片位置，用于输入框的入场动画。 */
  requestFix: (prompt: string, sourceRect: DOMRect) => void
}

/** 只有聊天页提供：分享页等只读场景没有输入框，Artifact 卡片不显示「让模型修复」。 */
export const ArtifactActionsContext = createContext<ArtifactActions | null>(null)

export function buildArtifactFixPrompt(title: string | null, errors: readonly string[]): string {
  const subject = title ? `「${title}」` : '上面的 Artifact '
  return `${subject}运行时出错：\n${errors.join('\n')}\n请修复后重新给出完整的 Artifact。`
}
