/** 删除确认标题：明确展示目标聊天，降低误删风险。 */
export function conversationDeleteConfirmationTitle(title: string | null): string {
  const displayTitle = title?.trim() || '新聊天'
  return `删除「${displayTitle}」？`
}
