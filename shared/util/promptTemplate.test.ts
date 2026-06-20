import { describe, expect, it } from 'vitest'
import { renderPromptTemplate } from './promptTemplate'

describe('renderPromptTemplate', () => {
  const vars = { current_date: '2026-06-20', current_user: '水水' }

  it('replaces known variables', () => {
    expect(renderPromptTemplate('Date: {{current_date}}', vars)).toBe('Date: 2026-06-20')
    expect(renderPromptTemplate('Hi {{current_user}}!', vars)).toBe('Hi 水水!')
  })

  it('tolerates inner whitespace', () => {
    expect(renderPromptTemplate('{{  current_date  }}', vars)).toBe('2026-06-20')
  })

  it('leaves unknown variables untouched', () => {
    expect(renderPromptTemplate('{{nope}} {{current_date}}', vars)).toBe('{{nope}} 2026-06-20')
  })

  it('returns template unchanged when no placeholders', () => {
    expect(renderPromptTemplate('plain text', vars)).toBe('plain text')
  })
})
