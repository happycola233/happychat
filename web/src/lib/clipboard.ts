function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false

  const root = document.body ?? document.documentElement
  if (!root) return false

  const selection = document.getSelection()
  const ranges: Range[] = []
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      ranges.push(selection.getRangeAt(i))
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0'

  root.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    root.removeChild(textarea)
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }

  return copied
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  const writeText = clipboard?.writeText
  if (typeof writeText === 'function') {
    try {
      await writeText.call(clipboard, text)
      return true
    } catch {
      // Fall back for denied permissions, insecure origins, and embedded browsers.
    }
  }

  return fallbackCopyText(text)
}
