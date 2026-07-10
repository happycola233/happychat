import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasoningEffortIcon } from './icons'

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
