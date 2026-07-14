/** 查询失败时不能沿用 TanStack Query 可能保留的旧分享标题。 */
export function resolveSharedDocumentTitle(
  shareTitle: string | null | undefined,
  isError: boolean,
): string | null | undefined {
  return isError ? null : shareTitle
}
