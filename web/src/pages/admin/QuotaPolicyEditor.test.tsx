import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QuotaPolicyEditor } from './QuotaPolicyEditor'

vi.mock('../../api/admin', () => ({
  listAdminModels: async () => [],
  listAdminModelGroups: async () => [],
  createQuotaPolicy: vi.fn(),
  updateQuotaPolicy: vi.fn(),
}))

vi.mock('../../components/ui/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}))

describe('QuotaPolicyEditor', () => {
  it('只向管理员说明标题总结不占额度，不展示后台记账细节', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <QuotaPolicyEditor open policy={null} onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(html).toContain('仅用户发起的对话与生图计入')
    expect(html).toContain('标题总结不计入任何额度规则')
    expect(html).not.toContain('请求事件与成本统计')
  })
})
