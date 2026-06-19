import { describe, expect, it } from 'vitest'
import { splitReasoningSections } from './reasoningSections'

describe('splitReasoningSections', () => {
  it('splits standalone bold headings into separate sections', () => {
    const sections = splitReasoningSections('Intro\n\n**First**\nBody\n\n**Second**\nMore')

    expect(sections).toEqual([
      { title: null, body: 'Intro' },
      { title: 'First', body: 'Body' },
      { title: 'Second', body: 'More' },
    ])
  })

  it('keeps summaries without headings in one section', () => {
    expect(splitReasoningSections('A plain summary.')).toEqual([
      { title: null, body: 'A plain summary.' },
    ])
  })

  it('does not split bold markers inside fenced code blocks', () => {
    const sections = splitReasoningSections(
      ['```md', '**Not a heading**', '```', '**Real heading**', 'Body'].join('\n'),
    )

    expect(sections).toEqual([
      { title: null, body: ['```md', '**Not a heading**', '```'].join('\n') },
      { title: 'Real heading', body: 'Body' },
    ])
  })
})
