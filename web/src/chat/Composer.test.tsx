// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AttachmentDTO } from '@shared/types/api'
import { Composer, type ComposerHandle } from './Composer'

let root: Root | null = null

beforeAll(() => {
  // 让 React 在 act() 中同步刷新状态更新
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const report: AttachmentDTO = {
  id: 'report',
  kind: 'file',
  mime: 'application/pdf',
  filename: '报告.pdf',
  byteSize: 1024,
}

function renderComposer() {
  const container = document.createElement('div')
  document.body.append(container)
  const ref = createRef<ComposerHandle>()
  root = createRoot(container)
  act(() => root!.render(<Composer ref={ref} onSend={vi.fn(() => true)} canFile />))
  return {
    handle: () => ref.current!,
    text: () => container.querySelector('textarea')!.value,
    attachmentNames: () =>
      Array.from(container.querySelectorAll('[data-testid="pending-attachment"]')).map(
        (tile) => tile.textContent,
      ),
  }
}

describe('发送失败回填', () => {
  it('空输入框直接放回原文与附件', () => {
    const composer = renderComposer()
    act(() => composer.handle().restoreDraft('三百字的长消息', [report]))
    expect(composer.text()).toBe('三百字的长消息')
    expect(composer.attachmentNames()).toEqual([expect.stringContaining('报告.pdf')])
  })

  it('等待期间已输入的新内容接在原文之后', () => {
    const composer = renderComposer()
    act(() => composer.handle().restoreDraft('新输入', []))
    act(() => composer.handle().restoreDraft('发送失败的原文', []))
    expect(composer.text()).toBe('发送失败的原文\n\n新输入')
  })
})
