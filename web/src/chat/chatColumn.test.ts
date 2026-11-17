import { describe, expect, it } from 'vitest'
import { chatColumnWidthPx } from './chatColumn'

describe('chatColumnWidthPx', () => {
  it('档位为 0 时保持 48rem 阅读宽度', () => {
    expect(chatColumnWidthPx({ viewportWidth: 2400, chatWidth: 0, sideReserve: 56 })).toBe(768)
  })

  it('档位为 100 时铺满可用宽度，并给两侧时间轴留出位置', () => {
    expect(chatColumnWidthPx({ viewportWidth: 2032, chatWidth: 100, sideReserve: 0 })).toBe(2000)
    expect(chatColumnWidthPx({ viewportWidth: 2032, chatWidth: 100, sideReserve: 56 })).toBe(1888)
  })

  it('按可用宽度比例铺开，窗口变宽时同步变宽', () => {
    // 可用 1968px，多出的 1200px 取 25%。
    expect(chatColumnWidthPx({ viewportWidth: 2000, chatWidth: 25, sideReserve: 0 })).toBe(1068)
    expect(chatColumnWidthPx({ viewportWidth: 1600, chatWidth: 25, sideReserve: 0 })).toBe(968)
  })

  it('窄于阅读宽度时直接铺满，与档位无关', () => {
    expect(chatColumnWidthPx({ viewportWidth: 600, chatWidth: 0, sideReserve: 56 })).toBe(568)
    expect(chatColumnWidthPx({ viewportWidth: 600, chatWidth: 100, sideReserve: 56 })).toBe(568)
  })
})
