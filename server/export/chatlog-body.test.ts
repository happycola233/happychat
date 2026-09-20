import { describe, expect, it } from 'vitest'
import { prepareChatlogText } from './chatlog-body'

describe('chatlog-md/2 显式块正文保护', () => {
  it('普通 Markdown 与显式块内安全的标题、附件行逐字保留', () => {
    const text = [
      '# @2026-09-21',
      '## 🤖 @ai',
      '🖼️ [示例图.png](assets/示例图.png)',
      '> 🤔 这是普通引用',
      '    <!-- @endpart -->',
      '\t<!-- @meta',
      '<!-- @metadata -->',
      '行内 <!-- @part answer --> 示例',
      '  正文缩进和硬换行  ',
      '',
    ].join('\n')
    expect(prepareChatlogText(text)).toEqual({ text })
    expect(prepareChatlogText('')).toEqual({ text: '' })
  })

  it.each([
    '<!-- @part answer -->',
    '<!--@part x-future -->',
    '<!-- @endpart -->',
    '<!-- @meta',
    '<!-- @meta key=value -->',
    '<!-- @part',
  ])('结构标记及任意既有反斜杠都只添加一层：%s', (marker) => {
    for (const prefix of ['', '\\', '\\\\', '\\\\\\']) {
      const text = `${prefix}${marker}`
      expect(prepareChatlogText(text)).toEqual({ text: `\\${text}` })
    }
  })

  it('可闭合代码围栏内所有标记和已有反斜杠不变', () => {
    const text = [
      '```md',
      '<!-- @part answer -->',
      '\\<!-- @endpart -->',
      '\\\\<!-- @meta',
      '```',
      '<!-- @endpart -->',
    ].join('\n')
    expect(prepareChatlogText(text)).toEqual({
      text: text.replace(/\n<!-- @endpart -->$/, '\n\\<!-- @endpart -->'),
    })
  })

  it.each([
    { open: '````md', other: '~~~', short: '```', close: '`````  ' },
    { open: '   ~~~~ md', other: '````', short: '~~~', close: '  ~~~~~\t' },
  ])('围栏闭合必须匹配字符与最短长度：$open', ({ open, other, short, close }) => {
    const lines = [open, other, '<!-- @meta', short, '\\<!-- @part answer -->', close]
    const code = lines.join('\n')
    expect(prepareChatlogText(`${code}\n<!-- @endpart -->`)).toEqual({
      text: `${code}\n\\<!-- @endpart -->`,
    })
  })

  it('尾随非空白的同字符围栏不关闭代码块', () => {
    const text = '```md\n```带说明\n<!-- @endpart -->\n```'
    expect(prepareChatlogText(text)).toEqual({ text })
  })

  it('含反引号的 info string 不误判为围栏；波浪线围栏允许它', () => {
    const text = '```inline```\n<!-- @endpart -->'
    expect(prepareChatlogText(text)).toEqual({ text: '```inline```\n\\<!-- @endpart -->' })
    const tildeCode = '~~~ `md`\n<!-- @endpart -->\n~~~'
    expect(prepareChatlogText(tildeCode)).toEqual({ text: tildeCode })
  })

  it('四空格缩进代码与转义的围栏不启动围栏状态', () => {
    const text = '    ```md\n<!-- @part answer -->\n\\```md\n<!-- @endpart -->'
    expect(prepareChatlogText(text)).toEqual({
      text: '    ```md\n\\<!-- @part answer -->\n\\```md\n\\<!-- @endpart -->',
    })
  })

  it.each(['', '   '])('普通 HTML 注释中的标记与围栏不改写（缩进 %j）', (indent) => {
    const comment = `${indent}<!-- 普通注释\n\`\`\`md\n\\<!-- @meta\n<!-- @endpart -->`
    // endpart 形状的行也仅关闭 HTML 注释；其下一行才恢复结构标记保护。
    expect(prepareChatlogText(`${comment}\n<!-- @endpart -->`)).toEqual({
      text: `${comment}\n\\<!-- @endpart -->`,
    })
  })

  it('单行闭合注释不影响后续标记保护', () => {
    const text = '<!-- 完整注释 -->\n<!-- @meta'
    expect(prepareChatlogText(text)).toEqual({ text: '<!-- 完整注释 -->\n\\<!-- @meta' })
  })

  it.each([
    { text: '已停止的回复\n```ts\nconst unfinished =', close: '```' },
    { text: '~~~~~md\n~~~\n<!-- @endpart -->', close: '~~~~~' },
    { text: '   ```md\n<!-- 尚未结束', close: '```' },
    { text: '<!-- 用户尚未写完的注释', close: '-->' },
    { text: '   <!-- 注释中的围栏\n```md', close: '-->' },
  ])('截断结构补齐并返回补齐前完整原文：$close', ({ text, close }) => {
    expect(prepareChatlogText(text)).toEqual({ text: `${text}\n${close}`, originalText: text })
  })

  it('补齐截断结构同时保留其前面经过转义的原始内容', () => {
    const text = '\\<!-- @part answer -->\n```md\n未完成代码'
    expect(prepareChatlogText(text)).toEqual({
      text: '\\\\<!-- @part answer -->\n```md\n未完成代码\n```',
      originalText: text,
    })
  })

  it.each(['\n', '\r\n'])('保留原文换行与尾随空格，补齐时沿用换行类型 %j', (newline) => {
    const text = `说明  ${newline}\`\`\`md${newline}未完成  ${newline}`
    expect(prepareChatlogText(text)).toEqual({ text: `${text}\`\`\``, originalText: text })
    const complete = `<!-- @meta key=value -->${newline}正文  ${newline}`
    expect(prepareChatlogText(complete)).toEqual({ text: `\\${complete}` })
  })
})
