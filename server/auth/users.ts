import type { PublicUser } from '@shared/types/api'
import type { AuthUser } from '../http/types'

export function toPublicUser(u: AuthUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
  }
}
