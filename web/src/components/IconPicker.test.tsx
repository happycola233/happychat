import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelIcon } from '@shared/types/domain'

interface CapturedMutationOptions {
  onSuccess?: (...args: unknown[]) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as CapturedMutationOptions[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: () => ({
    data: [{ id: 'icon-a', name: '当前图标', createdAt: 1 }],
    isPending: false,
  }),
  useMutation: (options: CapturedMutationOptions) => {
    mocks.mutationOptions.push(options)
    return { mutate: vi.fn(), isPending: false }
  },
}))

import { CustomIconGrid } from './IconPicker'

describe('CustomIconGrid', () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockClear()
    mocks.mutationOptions.length = 0
  })

  it('删除当前图标后清空草稿，并为键盘与移动端保留可见删除入口', () => {
    const onChange = vi.fn<(icon: ModelIcon | null) => void>()
    const html = renderToStaticMarkup(
      <CustomIconGrid value={{ type: 'custom', id: 'icon-a' }} onChange={onChange} />,
    )

    expect(html).toContain('aria-label="删除图标「当前图标」"')
    expect(html).toContain('删除当前图标「当前图标」')
    expect(html).toContain('h-10 w-full')
    expect(html).toContain('sm:group-focus-within/icon:flex')

    const removeMutation = mocks.mutationOptions[1]
    expect(removeMutation).toBeDefined()
    removeMutation?.onSuccess?.({ ok: true }, 'icon-b')
    expect(onChange).not.toHaveBeenCalled()
    removeMutation?.onSuccess?.({ ok: true }, 'icon-a')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
