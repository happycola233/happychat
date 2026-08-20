import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUserDTO } from '@shared/types/api'
import { UserScopePanel } from './UserScopePanel'
import type { UserScopePanelCopy } from './UserScopePanel'

const copy: UserScopePanelCopy = {
  allCaption: '所有账号都在范围内',
  selectedCaption: '仅勾选账号在范围内',
  allSummary: (count) => `当前 ${count} 位用户`,
  allDescription: '新账号自动加入',
  emptySelection: '至少选择一位用户',
  selectionOverLimit: (limit, count) => `最多 ${limit} 位，当前 ${count} 位`,
}

function user(patch: Partial<AdminUserDTO> = {}): AdminUserDTO {
  return {
    id: 'user-1',
    username: 'alice',
    role: 'user',
    displayName: '爱丽丝',
    avatarUrl: null,
    disabled: false,
    mustChangePassword: false,
    canShare: null,
    createdAt: 0,
    lastLoginAt: null,
    conversationCount: 0,
    ...patch,
  }
}

describe('UserScopePanel', () => {
  it('renders the shared all-user summary with light and dark surfaces', () => {
    const html = renderToStaticMarkup(
      <UserScopePanel
        users={[user(), user({ id: 'admin-1', username: 'root', role: 'admin' })]}
        mode="all"
        selected={new Set()}
        onModeChange={vi.fn()}
        onSelectionChange={vi.fn()}
        selectionLimit={10_000}
        copy={copy}
        radioGroupLabel="测试范围"
      />,
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="测试范围"')
    expect(html).toContain('所有用户')
    expect(html).toContain('指定用户')
    expect(html).toContain('当前 2 位用户')
    expect(html).toContain('border-dashed')
    expect(html).toContain('dark:bg-neutral-700')
    expect(html).not.toContain('搜索显示名称或用户名')
  })

  it('renders searchable grouped users, selected state and current-user marker', () => {
    const html = renderToStaticMarkup(
      <UserScopePanel
        users={[
          user({ id: 'admin-1', username: 'root', displayName: '管理员', role: 'admin' }),
          user(),
        ]}
        mode="selected"
        selected={new Set(['user-1'])}
        onModeChange={vi.fn()}
        onSelectionChange={vi.fn()}
        currentUserId="user-1"
        selectionLimit={10_000}
        copy={copy}
        radioGroupLabel="测试范围"
      />,
    )

    expect(html).toContain('搜索显示名称或用户名')
    expect(html).toContain('管理员')
    expect(html).toContain('普通用户')
    expect(html).toContain('@alice')
    expect(html).toContain('checked=""')
    expect(html).toContain('你')
    expect(html).toContain('dark:bg-sky-500/[0.08]')
  })
})
