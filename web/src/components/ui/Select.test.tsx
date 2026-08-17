import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

describe('Select', () => {
  it('用自绘触发器取代原生 select，并保留当前选中文案', () => {
    const html = renderToStaticMarkup(
      <Select
        label="供应商"
        value="cpa"
        options={[
          { value: '', label: '全部供应商' },
          { value: 'cpa', label: 'CPA' },
        ]}
        onChange={() => undefined}
      />,
    )

    expect(html).not.toContain('<select')
    expect(html).not.toContain('<option')
    expect(html).toContain('供应商')
    expect(html).toContain('CPA')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('rounded-lg')
    expect(html).toContain('max-w-56')
    expect(html).toContain('dark:bg-neutral-800')
  })

  it('表单尺寸与无障碍名称走触发器，不回退浏览器默认箭头', () => {
    const html = renderToStaticMarkup(
      <Select
        size="md"
        className="w-full"
        aria-label="每页条数"
        value="50"
        options={[
          { value: '25', label: '25 条' },
          { value: '50', label: '50 条' },
        ]}
      />,
    )

    expect(html).toContain('aria-label="每页条数"')
    expect(html).toContain('50 条')
    expect(html).toContain('w-full')
    expect(html).toContain('rounded-xl')
    expect(html).not.toContain('<select')
  })
})
