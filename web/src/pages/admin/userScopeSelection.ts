import type { AdminUserDTO } from '@shared/types/api'
import type { UserRole } from '@shared/types/domain'

export interface UserScopeUserGroup {
  role: UserRole
  label: string
  users: AdminUserDTO[]
}

/** 用户范围搜索同时匹配显示名称与登录名，中文与英文均使用同一小写口径。 */
export function filterUserScopeUsers(users: AdminUserDTO[], search: string): AdminUserDTO[] {
  const keyword = search.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return users
  return users.filter((user) =>
    [user.displayName, user.username].some((value) =>
      value?.toLocaleLowerCase('zh-CN').includes(keyword),
    ),
  )
}

/** 管理员固定在前；组内先展示可登录账号，再按名称稳定排序。 */
export function groupUserScopeUsers(users: AdminUserDTO[]): UserScopeUserGroup[] {
  const sortUsers = (items: AdminUserDTO[]) =>
    [...items].sort(
      (left, right) =>
        Number(left.disabled) - Number(right.disabled) ||
        (left.displayName || left.username).localeCompare(
          right.displayName || right.username,
          'zh-CN',
        ),
    )

  return [
    {
      role: 'admin',
      label: '管理员',
      users: sortUsers(users.filter((user) => user.role === 'admin')),
    },
    {
      role: 'user',
      label: '普通用户',
      users: sortUsers(users.filter((user) => user.role === 'user')),
    },
  ]
}

/** 返回新 Set，避免选择器草稿发生原地修改，便于 React 精确刷新。 */
export function setUserScopeSelection(
  selected: ReadonlySet<string>,
  userIds: Iterable<string>,
  shouldSelect: boolean,
): Set<string> {
  const next = new Set(selected)
  for (const userId of userIds) {
    if (shouldSelect) next.add(userId)
    else next.delete(userId)
  }
  return next
}

/** 只保留仍存在的账号，避免删除账号后出现界面不可见的幽灵 ID。 */
export function keepExistingUserScopeIds(
  userIds: readonly string[],
  users: readonly AdminUserDTO[],
): string[] {
  const existingUserIds = new Set(users.map((user) => user.id))
  return userIds.filter((userId) => existingUserIds.has(userId))
}

/** 用户范围按集合比较；服务端返回顺序变化不应被误判为修改。 */
export function sameUserScope(
  left: { mode: 'all' | 'selected'; userIds: readonly string[] },
  right: { mode: 'all' | 'selected'; userIds: readonly string[] },
): boolean {
  if (left.mode !== right.mode) return false
  if (left.mode === 'all') return true
  if (left.userIds.length !== right.userIds.length) return false
  const leftIds = new Set(left.userIds)
  return right.userIds.every((userId) => leftIds.has(userId))
}
