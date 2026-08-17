import { describe, expect, it } from 'vitest'
import { placeSelectMenu } from './selectMenuPosition'

const trigger = { top: 80, left: 40, bottom: 116, width: 160 }

describe('placeSelectMenu', () => {
  it('优先落在触发器下方，宽度对齐触发器', () => {
    const coords = placeSelectMenu({
      trigger,
      viewport: { width: 800, height: 600 },
      contentHeight: 200,
    })

    expect(coords.placement).toBe('below')
    expect(coords.top).toBe(122)
    expect(coords.bottom).toBeUndefined()
    expect(coords.left).toBe(40)
    expect(coords.width).toBe(160)
    expect(coords.maxHeight).toBe(280)
  })

  it('下方空间不足时翻到上方，并用 bottom 锚定', () => {
    const coords = placeSelectMenu({
      trigger: { top: 520, left: 40, bottom: 556, width: 160 },
      viewport: { width: 800, height: 600 },
      contentHeight: 200,
    })

    expect(coords.placement).toBe('above')
    expect(coords.top).toBeUndefined()
    expect(coords.bottom).toBe(86)
    expect(coords.maxHeight).toBe(280)
  })

  it('贴近右缘时把面板钳回视口内', () => {
    const coords = placeSelectMenu({
      trigger: { top: 80, left: 760, bottom: 116, width: 160 },
      viewport: { width: 800, height: 600 },
      contentHeight: 80,
    })

    expect(coords.left).toBe(632)
    expect(coords.width).toBe(160)
  })

  it('可用高度不足时压缩滚动区而不是溢出视口', () => {
    const coords = placeSelectMenu({
      trigger: { top: 40, left: 20, bottom: 76, width: 120 },
      viewport: { width: 400, height: 160 },
      contentHeight: 280,
    })

    expect(coords.placement).toBe('below')
    expect(coords.maxHeight).toBe(70)
  })

  it('内容比触发器更宽时按内容撑开，但仍不超过上限', () => {
    const coords = placeSelectMenu({
      trigger,
      viewport: { width: 800, height: 600 },
      contentHeight: 80,
      menuWidth: 280,
    })

    expect(coords.width).toBe(280)
    expect(coords.left).toBe(40)
  })

  it('极宽内容会被压到上限，避免撑出视口', () => {
    const coords = placeSelectMenu({
      trigger,
      viewport: { width: 800, height: 600 },
      contentHeight: 80,
      menuWidth: 720,
    })

    expect(coords.width).toBe(360)
  })
})
