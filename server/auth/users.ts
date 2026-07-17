import { basename } from 'node:path'
import type { PublicUser } from '@shared/types/api'
import type { AuthUser } from '../http/types'

interface UserWithAvatar {
  id: string
  avatarPath: string | null
}

/**
 * 头像文件名包含每次上传生成的新 UUID；把它放入查询参数可在更换头像后自然破除浏览器缓存。
 * 所有向前端暴露头像的 DTO 共用这里，避免不同页面生成出不一致的 URL。
 */
export function getUserAvatarUrl(user: UserWithAvatar): string | null {
  return user.avatarPath ? `/api/auth/avatar/${user.id}?v=${basename(user.avatarPath)}` : null
}

export function toPublicUser(u: AuthUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    avatarUrl: getUserAvatarUrl(u),
  }
}
