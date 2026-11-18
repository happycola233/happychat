import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextAndHtml, copyToClipboard } from './clipboard'

/** 模拟浏览器：execCommand('copy') 同步派发 copy 事件给已注册的监听。 */
function stubCopyEventDocument(execResult = true) {
  const listeners = new Set<(event: ClipboardEvent) => void>()
  const setData = vi.fn()
  const preventDefault = vi.fn()
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_type: string, listener: (event: ClipboardEvent) => void) =>
      listeners.add(listener),
    ),
    removeEventListener: vi.fn((_type: string, listener: (event: ClipboardEvent) => void) =>
      listeners.delete(listener),
    ),
    execCommand: vi.fn(() => {
      const event = { clipboardData: { setData }, preventDefault } as unknown as ClipboardEvent
      for (const listener of listeners) listener(event)
      return execResult
    }),
  })
  return { listeners, setData, preventDefault }
}

describe('copyTextAndHtml', () => {
  it('writes plain text and html through the copy event', () => {
    const { listeners, setData, preventDefault } = stubCopyEventDocument()

    expect(copyTextAndHtml('**a**', '<strong>a</strong>')).toBe(true)

    expect(setData.mock.calls).toEqual([
      ['text/plain', '**a**'],
      ['text/html', '<strong>a</strong>'],
    ])
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })

  it('reports failure when the browser refuses to copy', () => {
    const { listeners } = stubCopyEventDocument(false)

    expect(copyTextAndHtml('a', '<p>a</p>')).toBe(false)
    expect(listeners.size).toBe(0)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copyToClipboard', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyToClipboard('hello')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when navigator.clipboard is missing', async () => {
    const textarea = {
      value: '',
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    }
    const root = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    }
    const execCommand = vi.fn(() => true)

    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {
      body: root,
      documentElement: root,
      createElement: vi.fn(() => textarea),
      execCommand,
      getSelection: vi.fn(() => null),
    })

    await expect(copyToClipboard('fallback text')).resolves.toBe(true)

    expect(textarea.value).toBe('fallback text')
    expect(textarea.select).toHaveBeenCalled()
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, 'fallback text'.length)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(root.appendChild).toHaveBeenCalledWith(textarea)
    expect(root.removeChild).toHaveBeenCalledWith(textarea)
  })

  it('falls back when Clipboard API writeText rejects', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('denied'))
    const textarea = {
      value: '',
      style: {} as CSSStyleDeclaration,
      setAttribute: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    }
    const root = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    }

    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('document', {
      body: root,
      documentElement: root,
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
      getSelection: vi.fn(() => null),
    })

    await expect(copyToClipboard('after reject')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('after reject')
    expect(textarea.value).toBe('after reject')
  })
})
