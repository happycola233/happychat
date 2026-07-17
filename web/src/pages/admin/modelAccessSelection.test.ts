import { describe, expect, it } from 'vitest'
import type { AdminUserDTO } from '@shared/types/api'
import {
  filterModelAccessUsers,
  groupModelAccessUsers,
  keepExistingModelAccessUserIds,
  sameModelAccess,
  setModelAccessSelection,
} from './modelAccessSelection'

function user(
  id: string,
  role: AdminUserDTO['role'],
  displayName: string | null,
  disabled = false,
): AdminUserDTO {
  return {
    id,
    username: `${id}-login`,
    role,
    displayName,
    avatarUrl: null,
    disabled,
    canShare: null,
    createdAt: 0,
    lastActiveAt: null,
    conversationCount: 0,
  }
}

describe('model access user selection', () => {
  const users = [
    user('normal', 'user', '普通成员'),
    user('disabled-admin', 'admin', '停用管理员', true),
    user('admin', 'admin', '站点管理员'),
  ]

  it('searches both display names and usernames', () => {
    expect(filterModelAccessUsers(users, '普通').map((item) => item.id)).toEqual(['normal'])
    expect(filterModelAccessUsers(users, 'DISABLED-ADMIN-LOGIN').map((item) => item.id)).toEqual([
      'disabled-admin',
    ])
  })

  it('groups administrators first and puts disabled accounts last', () => {
    const groups = groupModelAccessUsers(users)
    expect(groups.map((group) => group.role)).toEqual(['admin', 'user'])
    expect(groups[0]?.users.map((item) => item.id)).toEqual(['admin', 'disabled-admin'])
  })

  it('toggles a visible subset without losing hidden selections', () => {
    const selected = new Set(['hidden', 'admin'])
    const added = setModelAccessSelection(selected, ['normal'], true)
    expect([...added].sort()).toEqual(['admin', 'hidden', 'normal'])
    expect([...selected].sort()).toEqual(['admin', 'hidden'])

    const removed = setModelAccessSelection(added, ['admin', 'normal'], false)
    expect([...removed]).toEqual(['hidden'])
  })

  it('drops access IDs whose users disappeared between the two reads', () => {
    expect(keepExistingModelAccessUserIds(['admin', 'deleted', 'normal'], users)).toEqual([
      'admin',
      'normal',
    ])
  })

  it('compares selected access as a set while keeping the mode explicit', () => {
    expect(
      sameModelAccess(
        { accessMode: 'selected', userIds: ['admin', 'normal'] },
        { accessMode: 'selected', userIds: ['normal', 'admin'] },
      ),
    ).toBe(true)
    expect(
      sameModelAccess(
        { accessMode: 'selected', userIds: ['admin'] },
        { accessMode: 'selected', userIds: ['normal'] },
      ),
    ).toBe(false)
    expect(
      sameModelAccess(
        { accessMode: 'all', userIds: ['ignored-stale-id'] },
        { accessMode: 'all', userIds: [] },
      ),
    ).toBe(true)
    expect(
      sameModelAccess({ accessMode: 'all', userIds: [] }, { accessMode: 'selected', userIds: [] }),
    ).toBe(false)
  })
})
