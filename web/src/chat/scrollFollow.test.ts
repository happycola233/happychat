import { describe, expect, it } from 'vitest'
import { resolveAutoFollowAfterScroll } from './scrollFollow'

describe('resolveAutoFollowAfterScroll', () => {
  it('用户即使只向上滚动少量也会立即暂停自动跟随', () => {
    expect(
      resolveAutoFollowAfterScroll({
        isAutoFollowing: true,
        isProgrammaticScroll: false,
        previous: { scrollTop: 1000, scrollHeight: 1500 },
        current: { scrollTop: 990, scrollHeight: 1500 },
        clientHeight: 480,
      }),
    ).toBe(false)
  })

  it('暂停后不会因为流式内容增长而自动恢复跟随', () => {
    expect(
      resolveAutoFollowAfterScroll({
        isAutoFollowing: false,
        isProgrammaticScroll: false,
        previous: { scrollTop: 990, scrollHeight: 1500 },
        current: { scrollTop: 990, scrollHeight: 1520 },
        clientHeight: 480,
      }),
    ).toBe(false)
  })

  it('用户向下回到底部后恢复自动跟随', () => {
    expect(
      resolveAutoFollowAfterScroll({
        isAutoFollowing: false,
        isProgrammaticScroll: false,
        previous: { scrollTop: 900, scrollHeight: 1500 },
        current: { scrollTop: 1020, scrollHeight: 1500 },
        clientHeight: 480,
      }),
    ).toBe(true)
  })

  it('内容折叠导致滚动位置上移时保持原有跟随状态', () => {
    expect(
      resolveAutoFollowAfterScroll({
        isAutoFollowing: true,
        isProgrammaticScroll: false,
        previous: { scrollTop: 1000, scrollHeight: 1500 },
        current: { scrollTop: 900, scrollHeight: 1400 },
        clientHeight: 400,
      }),
    ).toBe(true)
  })

  it('程序触发的上移不会被误判为用户暂停', () => {
    expect(
      resolveAutoFollowAfterScroll({
        isAutoFollowing: true,
        isProgrammaticScroll: true,
        previous: { scrollTop: 1000, scrollHeight: 1500 },
        current: { scrollTop: 600, scrollHeight: 1500 },
        clientHeight: 480,
      }),
    ).toBe(true)
  })
})
