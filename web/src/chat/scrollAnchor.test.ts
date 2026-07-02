import { describe, expect, it } from 'vitest'
import { resolveAnchoredScrollTop } from './scrollAnchor'

describe('resolveAnchoredScrollTop', () => {
  it('补偿锚点上方内容收缩而不跳到底部', () => {
    expect(resolveAnchoredScrollTop(600, 40, 20, 1200)).toBe(580)
  })

  it('浏览器已自动保持锚点时不会重复补偿', () => {
    expect(resolveAnchoredScrollTop(580, 40, 40, 1200)).toBe(580)
  })

  it('将补偿结果限制在合法滚动范围内', () => {
    expect(resolveAnchoredScrollTop(10, 100, 0, 1200)).toBe(0)
    expect(resolveAnchoredScrollTop(1190, 0, 100, 1200)).toBe(1200)
  })
})
