import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelGroupIcon, ModelIcon } from '@shared/types/domain'

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

import { CustomIconGrid, IconPicker } from './IconPicker'

describe('IconPicker summary field', () => {
  it('用完整摘要字段表达默认状态，不再把“未设置”塞进小方块', () => {
    const html = renderToStaticMarkup(
      <IconPicker
        value={null}
        onChange={vi.fn()}
        emptyState={{
          preview: <span aria-hidden>folder-preview</span>,
          title: '默认文件夹图标',
          description: '未选择图标时使用下方颜色',
        }}
      />,
    )

    expect(html).toContain('min-h-16')
    expect(html).toContain('默认文件夹图标')
    expect(html).toContain('未选择图标时使用下方颜色')
    expect(html).toContain('folder-preview')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('>未设置<')
    const previewContainer = html.match(/<span data-testid="icon-picker-preview"[^>]*>/)?.[0]
    expect(previewContainer).toBeDefined()
    expect(previewContainer).not.toMatch(/\b(?:rounded|bg-neutral)/)
  })

  it('已选择时提供语义明确且具有足够点击面积的恢复默认入口', () => {
    const html = renderToStaticMarkup(
      <IconPicker value={{ type: 'emoji', char: '🧠' }} onChange={vi.fn()} />,
    )

    expect(html).toContain('Emoji 图标')
    expect(html).toContain('aria-label="恢复默认图标"')
    expect(html).toContain('h-9')
    expect(html).toContain('恢复默认')
  })

  it('把分组无图标作为显式状态，并从默认文件夹提供快捷入口', () => {
    const onChange = vi.fn<(icon: ModelGroupIcon | null) => void>()
    const noneOption = {
      title: '无图标',
      description: '像“未分组”一样直接左对齐，不保留图标位置',
      showDefaultShortcut: true,
    }
    const defaultFolder = renderToStaticMarkup(
      <IconPicker value={null} onChange={onChange} noneOption={noneOption} />,
    )
    const withoutIcon = renderToStaticMarkup(
      <IconPicker value={{ type: 'none' }} onChange={onChange} noneOption={noneOption} />,
    )

    expect(defaultFolder).toContain('aria-label="不显示分组图标"')
    expect(defaultFolder).toContain('无图标')
    expect(withoutIcon).toContain('像“未分组”一样直接左对齐，不保留图标位置')
    expect(withoutIcon).toContain('aria-label="恢复默认图标"')
  })

  it('自动识别成功时可直接改用首字母，并能恢复自动识别', () => {
    const onChange = vi.fn<(icon: ModelIcon | null) => void>()
    const initialOption = {
      preview: <span aria-hidden>G</span>,
      available: true,
      showDefaultShortcut: true,
    }
    const automatic = renderToStaticMarkup(
      <IconPicker
        value={null}
        onChange={onChange}
        emptyState={{ title: '自动识别品牌图标' }}
        initialOption={initialOption}
      />,
    )
    const forcedInitial = renderToStaticMarkup(
      <IconPicker value={{ type: 'initial' }} onChange={onChange} initialOption={initialOption} />,
    )

    expect(automatic).toContain('aria-label="使用名称首字母图标"')
    expect(automatic).toContain('使用首字母')
    expect(forcedInitial).toContain('名称首字母')
    expect(forcedInitial).toContain('已关闭自动品牌识别')
    expect(forcedInitial).toContain('aria-label="恢复自动识别图标"')
  })
})

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
