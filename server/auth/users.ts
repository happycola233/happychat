import { basename } from 'node:path'
import type { PublicUser } from '@shared/types/api'
import type { AuthUser } from '../http/types'

export function toPublicUser(u: AuthUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    // 文件名含上传时新生成的 uuid，更换头像后 URL 自然变化以破除缓存。
    avatarUrl: u.avatarPath ? `/api/auth/avatar/${u.id}?v=${basename(u.avatarPath)}` : null,
  }
}
