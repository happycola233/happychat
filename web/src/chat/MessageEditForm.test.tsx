// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MessageEditForm } from './MessageEditForm'

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

function renderForm(onSubmit: () => Promise<boolean>, onCancel = vi.fn()) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      <MessageEditForm
        initialText="改过的提问"
        initialAttachments={[]}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    ),
  )
  return {
    onCancel,
    area: () => container.querySelector('.hc-message-edit-area')!,
    textarea: () => container.querySelector<HTMLTextAreaElement>('[data-testid="edit-textarea"]')!,
    submit: () =>
      act(() => container.querySelector<HTMLButtonElement>('[data-testid="edit-submit"]')!.click()),
  }
}

describe('编辑重发', () => {
  it('等待服务端期间锁住编辑区，失败后保留修改内容并可再次提交', async () => {
    let settle!: (accepted: boolean) => void
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)))
    const form = renderForm(onSubmit)

    form.submit()
    expect(onSubmit).toHaveBeenCalledWith({ text: '改过的提问', attachments: [] })
    expect(form.area().hasAttribute('inert')).toBe(true)

    await act(async () => settle(false))
    expect(form.onCancel).not.toHaveBeenCalled()
    expect(form.area().hasAttribute('inert')).toBe(false)
    expect(form.textarea().value).toBe('改过的提问')

    form.submit()
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('服务端接受后关闭编辑框', async () => {
    const form = renderForm(() => Promise.resolve(true))
    form.submit()
    await act(async () => {})
    expect(form.onCancel).toHaveBeenCalledOnce()
  })
})
