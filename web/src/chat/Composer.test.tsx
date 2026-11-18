// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Storage } from 'happy-dom'
import type { AttachmentDTO } from '@shared/types/api'
import { Composer } from './Composer'
import {
  flushComposerDrafts,
  restoreFailedComposerDraft,
  useComposerDrafts,
} from '../store/composerDrafts'

// 当前 Node 自带的实验性 localStorage 全局（未配置存储文件时为 undefined）会遮住 happy-dom 的实现
vi.stubGlobal('localStorage', new Storage())

let root: Root | null = null
let container: HTMLDivElement

beforeAll(() => {
  // 让 React 在 act() 中同步刷新状态更新
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  useComposerDrafts.setState({ byKey: {} })
  flushComposerDrafts()
  localStorage.clear()
})

const report: AttachmentDTO = {
  id: 'report',
  kind: 'file',
  mime: 'application/pdf',
  filename: '报告.pdf',
  byteSize: 1024,
}

function render(draftKey: string) {
  if (!root) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  act(() => root!.render(<Composer draftKey={draftKey} onSend={vi.fn(() => true)} canFile />))
}

const textarea = () => container.querySelector('textarea')!
const attachmentNames = () =>
  Array.from(container.querySelectorAll('[data-testid="pending-attachment"]')).map(
    (tile) => tile.textContent,
  )

/** 模拟用户输入：受控 textarea 需经原生 setter 赋值再派发 input 事件。 */
function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('输入框草稿', () => {
  it('每个对话各自保留草稿，切换后不串到其他对话', () => {
    render('alice:a')
    type('写给 A 的内容')
    render('alice:b')
    expect(textarea().value).toBe('')
    type('写给 B 的内容')
    render('alice:a')
    expect(textarea().value).toBe('写给 A 的内容')
  })

  it('输入写入 localStorage，内存里没有的草稿从 localStorage 恢复（刷新页面）', () => {
    render('alice:a')
    type('刷新前写的草稿')
    act(() => flushComposerDrafts())
    const saved = localStorage.getItem('happychat-draft:alice:a')!
    expect(JSON.parse(saved)).toMatchObject({ text: '刷新前写的草稿' })

    // 刷新后内存为空：用一个本页从未打开过的对话模拟
    localStorage.setItem('happychat-draft:alice:reloaded', saved)
    render('alice:reloaded')
    expect(textarea().value).toBe('刷新前写的草稿')
  })

  it('发送失败的内容与附件放回正在显示的输入框', () => {
    render('alice:a')
    act(() => restoreFailedComposerDraft('alice:a', '三百字的长消息', [report]))
    expect(textarea().value).toBe('三百字的长消息')
    expect(attachmentNames()).toEqual([expect.stringContaining('报告.pdf')])
  })
})
