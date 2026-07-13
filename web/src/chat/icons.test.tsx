import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BranchConversationIcon, ReasoningEffortIcon } from './icons'

function renderIcon(effort: string) {
  return renderToStaticMarkup(<ReasoningEffortIcon effort={effort} />)
}

describe('ReasoningEffortIcon', () => {
  it('renders max with the original xhigh artwork', () => {
    expect(renderIcon('max')).toBe(renderIcon('xhigh'))
  })

  it.each(['vendor-ultra', '__proto__', 'constructor'])(
    'renders unknown value %s with the original high artwork',
    (effort) => {
      expect(renderIcon(effort)).toBe(renderIcon('high'))
    },
  )
})

describe('BranchConversationIcon', () => {
  it('inlines the exact ChatGPT sprite paths with theme-aware stroke color', () => {
    const html = renderToStaticMarkup(<BranchConversationIcon />)

    expect(html).toContain('viewBox="0 0 20 20"')
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('fill="none"')
    expect(html).toContain('M12.5 4.5h3v3M12.5 15.5h3v-3')
    expect(html).toContain(
      'M3.33 10h4.682c.733 0 1.1 0 1.446-.083a3 3 0 0 0 .867-.36c.303-.185.562-.444 1.08-.963L15.5 4.5M12 12l3.5 3.5',
    )
    expect(html).not.toContain('&lt;use')
    expect(html).not.toContain('<use')
  })
})
