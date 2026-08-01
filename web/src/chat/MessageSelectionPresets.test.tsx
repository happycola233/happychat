import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messageIdsForPreset } from './messageSelection'
import { MessageSelectionPresets } from './MessageSelectionPresets'

const messages = [
  { id: 'user-1', role: 'user' as const },
  { id: 'assistant-1', role: 'assistant' as const },
  { id: 'user-2', role: 'user' as const },
  { id: 'assistant-2', role: 'assistant' as const },
]

function buttonTag(html: string, testId: string): string {
  return html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? ''
}

describe('MessageSelectionPresets', () => {
  it('按当前分支顺序生成全部、用户和 AI 三种预设', () => {
    expect(messageIdsForPreset(messages, 'all')).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ])
    expect(messageIdsForPreset(messages, 'user')).toEqual(['user-1', 'user-2'])
    expect(messageIdsForPreset(messages, 'assistant')).toEqual(['assistant-1', 'assistant-2'])
  })

  it('为导出弹窗渲染三种快捷操作，并高亮完全匹配的预设', () => {
    const html = renderToStaticMarkup(
      <MessageSelectionPresets
        messages={messages}
        selectedIds={new Set(['user-1', 'user-2'])}
        onChange={() => undefined}
        testIdPrefix="export"
      />,
    )

    expect(html).toContain('全部消息')
    expect(html).toContain('全部用户消息')
    expect(html).toContain('全部 AI 回复')
    expect(buttonTag(html, 'export-quick-all')).toContain('aria-pressed="false"')
    expect(buttonTag(html, 'export-quick-user')).toContain('aria-pressed="true"')
    expect(buttonTag(html, 'export-quick-ai')).toContain('aria-pressed="false"')
    expect(html).toContain('data-testid="export-quick-clear"')
  })

  it('选择为空时不显示多余的清空操作', () => {
    const html = renderToStaticMarkup(
      <MessageSelectionPresets
        messages={messages}
        selectedIds={new Set()}
        onChange={() => undefined}
        testIdPrefix="share"
      />,
    )

    expect(html).not.toContain('data-testid="share-quick-clear"')
  })
})
