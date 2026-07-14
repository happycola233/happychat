import { describe, expect, it } from 'vitest'
import { resolveSharedDocumentTitle } from '../pages/sharedDocumentTitle'
import { DEFAULT_DOCUMENT_TITLE, resolveDocumentTitle } from './useDocumentTitle'

describe('resolveDocumentTitle', () => {
  it.each([undefined, null, ''])(
    'uses the default title when the page title is %s',
    (pageTitle) => {
      expect(resolveDocumentTitle(pageTitle)).toBe(DEFAULT_DOCUMENT_TITLE)
    },
  )

  it('uses the conversation title verbatim without a brand suffix', () => {
    expect(resolveDocumentTitle('如何优化 React 渲染性能')).toBe('如何优化 React 渲染性能')
  })

  it('keeps a typewriter prefix verbatim while the title is animating', () => {
    expect(resolveDocumentTitle('如何优')).toBe('如何优')
  })

  it('uses a live shared title and drops stale data when the query fails', () => {
    expect(resolveSharedDocumentTitle('分享标题', false)).toBe('分享标题')
    expect(resolveDocumentTitle(resolveSharedDocumentTitle('旧分享标题', true))).toBe(
      DEFAULT_DOCUMENT_TITLE,
    )
  })
})
