import { describe, expect, it } from 'vitest'
import {
  getLobeIconCatalog,
  isPureCurrentColorIcon,
  renderLobeIconForTheme,
} from './lobe-icons'

describe('lobe icon color handling', () => {
  it('marks only pure currentColor variants as monochrome', () => {
    const catalog = new Map(getLobeIconCatalog().map((icon) => [icon.slug, icon.mono]))

    expect(catalog.get('yi')).toBe(true)
    expect(catalog.get('yi-color')).toBe(false)
    expect(catalog.get('aws')).toBe(true)
    expect(catalog.get('aws-color')).toBe(false)
  })

  it('rejects mixed fixed colors and gradients even when currentColor is present', () => {
    expect(
      isPureCurrentColorIcon(
        '<svg fill="currentColor"><path fill="#ff9900" d="M0 0h1v1z"/></svg>',
      ),
    ).toBe(false)
    expect(
      isPureCurrentColorIcon(
        '<svg fill="currentColor"><linearGradient id="g"><stop stop-color="currentColor"/></linearGradient></svg>',
      ),
    ).toBe(false)
  })

  it('replaces currentColor for each theme without changing fixed brand colors', () => {
    const svg = '<svg fill="currentColor"><path fill="#FF9900" stroke="currentColor"/></svg>'

    expect(renderLobeIconForTheme(svg, 'light')).toBe(
      '<svg fill="#171717"><path fill="#FF9900" stroke="#171717"/></svg>',
    )
    expect(renderLobeIconForTheme(svg, 'dark')).toBe(
      '<svg fill="#f5f5f5"><path fill="#FF9900" stroke="#f5f5f5"/></svg>',
    )
  })
})
