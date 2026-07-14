import { useLayoutEffect } from 'react'

export const DEFAULT_DOCUMENT_TITLE = 'HappyChat'

/** 空标题统一回退到品牌名；会话标题本身不追加任何后缀。 */
export function resolveDocumentTitle(pageTitle: string | null | undefined): string {
  return pageTitle || DEFAULT_DOCUMENT_TITLE
}

/**
 * 将 React 中的页面标题状态同步到浏览器标签页。
 *
 * 默认标题保留在 index.html 中，保证脚本加载前也正确；离开动态标题页面时再恢复默认值，
 * 避免会话标题残留到登录页或管理后台。
 */
export function useDocumentTitle(pageTitle: string | null | undefined): void {
  const documentTitle = resolveDocumentTitle(pageTitle)

  useLayoutEffect(() => {
    document.title = documentTitle
  }, [documentTitle])

  useLayoutEffect(
    () => () => {
      document.title = DEFAULT_DOCUMENT_TITLE
    },
    [],
  )
}
