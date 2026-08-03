import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FolderIdentityField } from './FolderIdentityField'

const noop = vi.fn()

describe('FolderIdentityField', () => {
  it('让无底板图标触发器与名称输入保持相同高度', () => {
    const html = renderToStaticMarkup(
      <FolderIdentityField
        name="项目资料"
        color="#f59e0b"
        emoji="📚"
        iconPickerOpen={false}
        autoFocusName={false}
        onNameChange={noop}
        onNameKeyDown={noop}
        onToggleIconPicker={noop}
      />,
    )

    expect(html).toContain('data-testid="folder-identity-field"')
    expect(html).toContain('flex h-11 items-center gap-2')
    expect(html).toContain('aria-label="选择文件夹图标"')
    expect(html).toContain('h-11 w-10')
    expect(html).toContain('border-0 bg-transparent')
    expect(html).toContain('📚')
    expect(html).toContain('h-6 w-6')
    expect(html).toContain('text-[22px]')
    expect(html).toContain('data-testid="folder-name-input"')
    expect(html).toContain('h-11 min-w-0 flex-1 rounded-xl border')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('shadow')
  })

  it('展开图标面板时旋转无底板提示箭头', () => {
    const html = renderToStaticMarkup(
      <FolderIdentityField
        name="项目资料"
        color={null}
        emoji={null}
        iconPickerOpen
        autoFocusName={false}
        onNameChange={noop}
        onNameKeyDown={noop}
        onToggleIconPicker={noop}
      />,
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="folder-emoji-picker-panel"')
    expect(html).toContain('rotate-180')
  })
})
