import type { AdminUserDTO, ModelAccessDTO } from '@shared/types/api'
import type { UserRole } from '@shared/types/domain'

export interface ModelAccessUserGroup {
  role: UserRole
  label: string
  users: AdminUserDTO[]
}

/** 用户范围搜索同时匹配显示名称与登录名，中文与英文均使用同一小写口径。 */
export function filterModelAccessUsers(users: AdminUserDTO[], search: string): AdminUserDTO[] {
  const keyword = search.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return users
  return users.filter((user) =>
    [user.displayName, user.username].some((value) =>
      value?.toLocaleLowerCase('zh-CN').includes(keyword),
    ),
  )
}

/** 管理员固定在前；组内先展示可登录账号，再按名称稳定排序。 */
export function groupModelAccessUsers(users: AdminUserDTO[]): ModelAccessUserGroup[] {
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
export function setModelAccessSelection(
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

/**
 * 访问名单与用户列表来自两个请求；用户恰好在两次读取之间被删除时，只保留仍存在的账号。
 * 这既避免界面出现“看不见但会随保存提交”的幽灵 ID，也让 unknown_users 恢复路径可复用同一口径。
 */
export function keepExistingModelAccessUserIds(
  userIds: readonly string[],
  users: readonly AdminUserDTO[],
): string[] {
  const existingUserIds = new Set(users.map((user) => user.id))
  return userIds.filter((userId) => existingUserIds.has(userId))
}

/** 模型访问策略的集合等价比较；服务端排序变化不应被误判为并发修改。 */
export function sameModelAccess(
  left: Pick<ModelAccessDTO, 'accessMode' | 'userIds'>,
  right: Pick<ModelAccessDTO, 'accessMode' | 'userIds'>,
): boolean {
  if (left.accessMode !== right.accessMode) return false
  if (left.accessMode === 'all') return true
  if (left.userIds.length !== right.userIds.length) return false
  const leftIds = new Set(left.userIds)
  return right.userIds.every((userId) => leftIds.has(userId))
}
