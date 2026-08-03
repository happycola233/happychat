import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('keeps native checkbox semantics behind the shared visual treatment', () => {
    const html = renderToStaticMarkup(
      <Checkbox checked onChange={() => undefined} ariaLabel="按分组显示" />,
    )

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('aria-label="按分组显示"')
    expect(html).toContain('appearance-none')
    expect(html).toContain('rounded-[5px]')
    expect(html).toContain('checked:bg-sky-500')
    expect(html).toContain('peer-checked:block')
    expect(html).toContain('dark:bg-neutral-800')
    expect(html).toContain('forced-colors:appearance-auto')
    expect(html).toContain('forced-colors:invisible')
    expect(html).not.toContain('forced-colors:hidden')
  })

  it('keeps the mixed-state overlay and disabled native semantics available', () => {
    const html = renderToStaticMarkup(
      <Checkbox
        checked={false}
        indeterminate
        disabled
        onChange={() => undefined}
        ariaLabel="选择当前分组"
      />,
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('opacity-50')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('indeterminate:bg-sky-500')
    expect(html).toContain('peer-indeterminate:block')
    expect(html).toContain('peer-checked:block')
  })
})
