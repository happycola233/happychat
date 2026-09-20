interface Fence {
  character: string
  length: number
}

/**
 * 为显式内容块保护字面结构标记。转义是可逆的一层，代码与普通 HTML 注释保持原样。
 * 截断的代码围栏/注释需补齐闭合行，否则会吞掉后续块；调用方必须把 originalText
 * 写入块的扩展元数据，保留补齐前的原文，不能把补齐后的展示文本冒充完整原始输出。
 */
export function prepareChatlogText(text: string): { text: string; originalText?: string } {
  let fence: Fence | null = null
  let comment = false
  const lines = text.split('\n').map((line) => {
    if (comment) {
      if (line.includes('-->')) comment = false
      return line
    }

    const token = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (
        token &&
        token[1]![0] === fence.character &&
        token[1]!.length >= fence.length &&
        line.slice(token[0].length).trim() === ''
      ) {
        fence = null
      }
      return line
    }
    // 反引号围栏的 info string 不能再包含反引号；如 ```inline``` 是行内代码。
    if (token && (token[1]![0] === '~' || !line.slice(token[0].length).includes('`'))) {
      fence = { character: token[1]![0]!, length: token[1]!.length }
      return line
    }

    // 已有反斜杠仍需加一层，否则读入器解码时会吃掉用户原有的反斜杠。
    if (/^\\*<!--\s*@(?:part|endpart|meta)\b/.test(line)) return `\\${line}`
    if (/^ {0,3}<!--/.test(line) && !line.includes('-->')) comment = true
    return line
  })

  const prepared = lines.join('\n')
  // 状态不会同时成立：围栏里的注释只是代码，注释里的围栏也只是注释文字。
  const openFence = fence as Fence | null
  const closer = openFence ? openFence.character.repeat(openFence.length) : comment ? '-->' : null
  if (closer === null) return { text: prepared }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  return {
    text: `${prepared}${prepared.endsWith('\n') ? '' : newline}${closer}`,
    originalText: text,
  }
}
