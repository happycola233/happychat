import { beforeEach, describe, expect, it } from 'vitest'
import { useContextSelection } from './contextSelection'

const chosen = { include: ['image'], exclude: ['old'] }
beforeEach(() => useContextSelection.setState({ byConversation: {}, revisions: {}, pending: {} }))

describe('一次性附件选择', () => {
  it('按聊天隔离，成功后只消费发送时的选择', () => {
    const store = useContextSelection.getState()
    store.set('a', chosen)
    store.set('b', chosen)
    store.accept('a', 'run', chosen)
    store.finish('run', false)
    expect(useContextSelection.getState().byConversation).toEqual({ b: chosen })
  })
  it('上游失败时恢复选择，用户可以原样重试', () => {
    const store = useContextSelection.getState()
    store.set('a', chosen)
    store.accept('a', 'run', chosen)
    store.finish('run', true)
    expect(useContextSelection.getState().byConversation.a).toEqual(chosen)
  })
  it('用户为下一次发送所作的调整不会被迟到的成功或失败覆盖', () => {
    const store = useContextSelection.getState()
    store.set('a', chosen)
    store.accept('a', 'run', chosen)
    const next = { include: ['next'], exclude: [] }
    store.set('a', next)
    store.finish('run', true)
    expect(useContextSelection.getState().byConversation.a).toEqual(next)
    store.accept('a', 'late', chosen)
    expect(useContextSelection.getState().byConversation.a).toEqual(next)
  })
})
