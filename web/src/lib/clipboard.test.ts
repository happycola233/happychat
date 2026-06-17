import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

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
