import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FOLDER_COLOR } from '@shared/constants'
import type { AdminModelGroupDTO } from '@shared/types/api'
import { ModelGroupEditor } from './ModelGroupEditor'

vi.mock('../../components/ui/Modal', () => ({
  Modal: ({
    title,
    children,
    footer,
  }: {
    title: ReactNode
    children: ReactNode
    footer?: ReactNode
  }) => (
    <section aria-label={typeof title === 'string' ? title : '模型分组弹窗'}>
      {children}
      {footer}
    </section>
  ),
}))

vi.mock('../../components/IconPicker', () => ({
  IconPicker: ({ value }: { value: AdminModelGroupDTO['icon'] }) => (
    <div data-icon-state={value ? 'explicit' : 'default'} />
  ),
}))

vi.mock('../../components/ModelIcon', () => ({
  ModelGroupGlyph: ({
    group,
  }: {
    group: Pick<AdminModelGroupDTO, 'icon' | 'color'>
  }) => <span data-preview-color={group.color ?? ''}>{group.icon ? 'icon' : 'folder'}</span>,
}))

function renderEditor(group: AdminModelGroupDTO): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ModelGroupEditor group={group} onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

function groupFixture(
  overrides: Partial<AdminModelGroupDTO> = {},
): AdminModelGroupDTO {
  return {
    id: 'group-1',
    name: '测试分组',
    icon: null,
    color: null,
    sort: 100,
    modelCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('ModelGroupEditor appearance semantics', () => {
  it('shows the color field for the default folder and keeps its exact chosen color', () => {
    const html = renderEditor(groupFixture({ color: '#ef4444' }))

    expect(html).toContain('<legend')
    expect(html).not.toContain('aria-label="默认颜色"')
    expect(html).toContain('data-icon-state="default"')
    expect(html).toContain('data-preview-color="#ef4444"')
  })

  it('uses the yellow preset when a legacy default folder has no stored color', () => {
    const html = renderEditor(groupFixture({ color: null }))

    expect(html).toContain(`data-preview-color="${DEFAULT_FOLDER_COLOR}"`)
    expect(html).toContain(`aria-label="使用颜色 ${DEFAULT_FOLDER_COLOR}"`)
    expect(html).not.toContain('aria-label="默认颜色"')
  })

  it('hides and discards a legacy color whenever an explicit icon is selected', () => {
    const html = renderEditor(
      groupFixture({ icon: { type: 'emoji', char: '🧠' }, color: '#ef4444' }),
    )

    expect(html).toContain('data-icon-state="explicit"')
    expect(html).toContain('data-preview-color=""')
    expect(html).not.toContain('颜色（可选）')
    expect(html).not.toContain('#ef4444')
  })
})
