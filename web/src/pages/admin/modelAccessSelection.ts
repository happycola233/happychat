import type { ModelAccessDTO } from '@shared/types/api'
import {
  filterUserScopeUsers,
  groupUserScopeUsers,
  keepExistingUserScopeIds,
  sameUserScope,
  setUserScopeSelection,
} from './userScopeSelection'

// 保留模型域命名的导出，兼容既有调用；具体选择逻辑由公告与模型共用同一实现。
export const filterModelAccessUsers = filterUserScopeUsers
export const groupModelAccessUsers = groupUserScopeUsers
export const keepExistingModelAccessUserIds = keepExistingUserScopeIds
export const setModelAccessSelection = setUserScopeSelection

/** 模型访问策略的集合等价比较；服务端排序变化不应被误判为并发修改。 */
export function sameModelAccess(
  left: Pick<ModelAccessDTO, 'accessMode' | 'userIds'>,
  right: Pick<ModelAccessDTO, 'accessMode' | 'userIds'>,
): boolean {
  return sameUserScope(
    { mode: left.accessMode, userIds: left.userIds },
    { mode: right.accessMode, userIds: right.userIds },
  )
}
