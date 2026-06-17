import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasoningCard } from './ReasoningCard'

describe('ReasoningCard', () => {
  it('renders reasoning text through the shared Markdown renderer', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text={'Intro.**Heading**\n\n- item\n\n`code`'} thinking startedAt={1000} />,
    )

    expect(html).toContain('<strong>Heading</strong>')
    expect(html).toContain('<li>item</li>')
    expect(html).toContain('<code>code</code>')
    expect(html).not.toContain('Intro.**Heading**')
  })

  it('does not render an empty reasoning body', () => {
    const html = renderToStaticMarkup(<ReasoningCard text="" thinking startedAt={null} />)

    expect(html).toContain('正在思考')
    expect(html).not.toContain('max-h-64')
  })

  it('shows completed reasoning duration instead of the generic process label', () => {
    const html = renderToStaticMarkup(
      <ReasoningCard text="done" thinking={false} startedAt={null} durationMs={3500} />,
    )

    expect(html).toContain('已思考 3s')
    expect(html).not.toContain('思考过程')
  })
})
