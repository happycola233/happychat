import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminModelDTO, ProviderDTO } from '@shared/types/api'
import { ModelEditor } from './ModelEditor'
import ModelsPage from './ModelsPage'

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
    <section aria-label={typeof title === 'string' ? title : '模型弹窗'}>
      {children}
      {footer}
    </section>
  ),
}))

vi.mock('../../components/IconPicker', () => ({
  IconPicker: () => <div data-testid="icon-picker" />,
}))

function modelFixture(overrides: Partial<AdminModelDTO> = {}): AdminModelDTO {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    providerName: '供应商一',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    description: null,
    tags: [],
    icon: null,
    groupId: null,
    kind: 'responses',
    enabled: true,
    accessMode: 'all',
    allowedUserCount: 0,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
    allowedEfforts: [],
    defaultEffort: null,
    replayProviderContext: false,
    defaultWebSearch: false,
    defaultXSearch: false,
    defaultSystemPrompt: null,
    defaultParams: null,
    hardParams: null,
    pricing: null,
    sort: 100,
    ...overrides,
  }
}

function providerFixture(overrides: Partial<ProviderDTO> = {}): ProviderDTO {
  return {
    id: 'provider-1',
    name: '供应商一',
    baseUrl: 'https://example.test/v1',
    protocol: 'openai',
    enabled: true,
    hasApiKey: true,
    apiKeyMask: '********',
    modelCount: 1,
    createdAt: 1,
    ...overrides,
  }
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('ModelsPage model actions', () => {
  it('为每个模型提供创建副本的操作', () => {
    const client = queryClient()
    client.setQueryData(['admin', 'models'], [modelFixture()])
    client.setQueryData(['admin', 'model-groups'], [])

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ModelsPage />
      </QueryClientProvider>,
    )

    expect(html).toContain('aria-label="复制模型 GPT Test"')
  })

  it('编辑已有模型时展示完整供应商选择', () => {
    const client = queryClient()
    client.setQueryData(
      ['admin', 'providers'],
      [
        providerFixture(),
        providerFixture({
          id: 'provider-2',
          name: '供应商二',
          baseUrl: 'https://another.example.test',
          protocol: 'anthropic',
          modelCount: 0,
        }),
      ],
    )
    client.setQueryData(['admin', 'model-groups'], [])

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ModelEditor model={modelFixture()} onClose={() => undefined} />
      </QueryClientProvider>,
    )

    expect(html).toContain('所属供应商')
    expect(html).toContain('供应商一')
    expect(html).toContain('供应商二')
  })
})
