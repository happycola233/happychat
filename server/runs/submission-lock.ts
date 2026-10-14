const submissions = new Map<string, Promise<unknown>>()

/** 同一聊天的手动提交与队列提交串行准备，避免异步附件读取期间同时创建两轮。 */
export async function withConversationSubmission<T>(
  conversationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = submissions.get(conversationId)
  const current = (previous ?? Promise.resolve()).catch(() => undefined).then(work)
  submissions.set(conversationId, current)
  try {
    return await current
  } finally {
    if (submissions.get(conversationId) === current) submissions.delete(conversationId)
  }
}
