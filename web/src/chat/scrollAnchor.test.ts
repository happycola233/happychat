import { describe, expect, it } from 'vitest'
import { resolveAnchoredScrollTop, resolveNearestTargetScrollTop } from './scrollAnchor'

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

describe('resolveNearestTargetScrollTop', () => {
  it('目标已经可见时不滚动', () => {
    expect(
      resolveNearestTargetScrollTop({
        currentScrollTop: 120,
        scrollHeight: 1000,
        clientHeight: 300,
        containerTop: 0,
        containerBottom: 300,
        targetTop: 80,
        targetBottom: 140,
      }),
    ).toBe(120)
  })

  it('目标在下方时只滚到刚好露出，避免居中造成底部大留白', () => {
    expect(
      resolveNearestTargetScrollTop({
        currentScrollTop: 120,
        scrollHeight: 1000,
        clientHeight: 300,
        containerTop: 0,
        containerBottom: 300,
        targetTop: 420,
        targetBottom: 460,
        insetBottom: 40,
      }),
    ).toBe(320)
  })

  it('目标在上方时按顶部边距滚回可见区域', () => {
    expect(
      resolveNearestTargetScrollTop({
        currentScrollTop: 320,
        scrollHeight: 1000,
        clientHeight: 300,
        containerTop: 0,
        containerBottom: 300,
        targetTop: -30,
        targetBottom: 20,
        insetTop: 20,
      }),
    ).toBe(270)
  })

  it('滚动结果不会超过容器最大滚动范围', () => {
    expect(
      resolveNearestTargetScrollTop({
        currentScrollTop: 480,
        scrollHeight: 800,
        clientHeight: 300,
        containerTop: 0,
        containerBottom: 300,
        targetTop: 520,
        targetBottom: 620,
      }),
    ).toBe(500)
  })
})
