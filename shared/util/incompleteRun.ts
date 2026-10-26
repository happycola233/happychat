/** 三种文本协议保留各自的终止原因，在用户提示中统一解释。 */
export function incompleteRunMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'max_output_tokens':
    case 'max_tokens':
      return '已达到输出长度上限，回复未完成。'
    case 'model_context_window_exceeded':
      return '已达到模型的上下文长度上限，回复未完成。'
    default:
      return '生成提前结束，回复未完成。'
  }
}
