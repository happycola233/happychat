import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const store = { collapsed: false }

vi.mock('../../store/adminSidebar', () => ({
  useAdminSidebarStore: (
    selector: (state: { collapsed: boolean; toggleCollapsed: () => void }) => unknown,
  ) => selector({ collapsed: store.collapsed, toggleCollapsed: () => undefined }),
}))

const { default: AdminLayout } = await import('./AdminLayout')

function render() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/admin/overview']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="overview" element={<div>概览内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminLayout', () => {
  it('展开态显示分组标题、文案与收起按钮', () => {
    store.collapsed = false
    const html = render()

    expect(html).toContain('data-testid="admin-sidebar"')
    expect(html).toContain('data-collapsed="false"')
    expect(html).toContain('w-60')
    expect(html).toContain('aria-label="收起侧边栏"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('洞察')
    expect(html).toContain('管理后台')
    expect(html).toContain('aria-label="返回聊天"')
    expect(html).toContain('mb-4 flex items-center gap-1')
    expect(html).toContain('概览内容')
  })

  it('折叠态收成图标轨，分组标题隐藏，文案留给读屏', () => {
    store.collapsed = true
    const html = render()

    expect(html).toContain('data-collapsed="true"')
    expect(html).toContain('w-16')
    expect(html).toContain('aria-label="展开侧边栏"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('洞察')
    expect(html).toContain('sr-only')
    expect(html).toContain('概览')
    expect(html).toContain('aria-label="返回聊天"')
  })
})
