/** 管理端头像回退字：空 / 空白显示名回退用户名，再取第一个字素。 */
export function userDisplayInitial(username: string, displayName: string | null): string {
  const source = (displayName?.trim() || username).trim()
  return [...source][0]?.toLocaleUpperCase('zh-CN') ?? '?'
}
