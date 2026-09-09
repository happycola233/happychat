import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  }
  vi.stubGlobal('window', { localStorage: storage })
  return storage
})

import { useChatPrefs } from './chat'

const models = [{ id: 'first' }, { id: 'preferred' }, { id: 'historical' }]
const prefs = () => useChatPrefs.getState()
const persistedPrefs = () => JSON.parse(storage.getItem('happychat-prefs')!).state

describe('新聊天默认模型', () => {
  beforeEach(() => {
    storage.clear()
    useChatPrefs.setState(useChatPrefs.getInitialState())
  })

  afterAll(() => vi.unstubAllGlobals())

  it('只有选择器中的手动选择会保存默认，包括在旧会话中选模', () => {
    prefs().selectModel('preferred')
    prefs().resetActive({ modelId: 'historical' })
    expect(persistedPrefs().pinnedModelId).toBe('preferred')

    prefs().selectModel('historical')
    prefs().resetActive({})
    expect(prefs().activeModelId).toBe('historical')
    expect(persistedPrefs().pinnedModelId).toBe('historical')
    expect(persistedPrefs()).not.toHaveProperty('activeModelId')
  })

  it.each(['historical', 'removed', null])(
    '打开历史模型 %s 的报错会话后，新聊天仍沿用手动默认',
    (lastModelId) => {
      prefs().selectModel('preferred')
      prefs().resetActive({ modelId: lastModelId, webSearch: true, effort: 'high' })
      prefs().reconcileActiveModel(models)
      expect(prefs().activeModelId).toBe(
        lastModelId === 'historical' ? 'historical' : 'preferred',
      )
      expect(persistedPrefs().pinnedModelId).toBe('preferred')

      prefs().resetActive({})
      prefs().reconcileActiveModel(models)
      expect(prefs().activeModelId).toBe('preferred')
      expect(prefs().activeWebSearch).toBeNull()
      expect(prefs().activeEffort).toBeNull()
    },
  )

  it('默认也失效时只临时回退首项，模型恢复后新聊天再次沿用原默认', () => {
    prefs().selectModel('preferred')
    prefs().resetActive({ modelId: 'removed' })
    prefs().reconcileActiveModel([{ id: 'first' }])
    expect(prefs().activeModelId).toBe('first')
    expect(persistedPrefs().pinnedModelId).toBe('preferred')

    prefs().resetActive({})
    prefs().reconcileActiveModel(models)
    expect(prefs().activeModelId).toBe('preferred')
  })

  it('首次使用、空目录及延迟加载不把回退当成手动选择', () => {
    prefs().resetActive({})
    prefs().reconcileActiveModel([])
    expect(prefs().activeModelId).toBeNull()
    prefs().reconcileActiveModel(models)
    expect(prefs().activeModelId).toBe('first')
    expect(persistedPrefs().pinnedModelId).toBeNull()

    prefs().selectModel('preferred')
    prefs().reconcileActiveModel([])
    expect(prefs().activeModelId).toBeNull()
    expect(persistedPrefs().pinnedModelId).toBe('preferred')
    prefs().reconcileActiveModel(models)
    expect(prefs().activeModelId).toBe('preferred')
  })

  it('目录刷新保留有效的会话临时模型', () => {
    prefs().selectModel('preferred')
    prefs().resetActive({ modelId: 'historical' })
    prefs().reconcileActiveModel(models)
    prefs().reconcileActiveModel([...models].reverse())
    expect(prefs().activeModelId).toBe('historical')
    expect(persistedPrefs().pinnedModelId).toBe('preferred')
  })

  it('图片编辑的自动模型切换不改变新聊天默认，刷新后仍能恢复默认', async () => {
    prefs().selectModel('preferred')
    prefs().setActiveModel('image')
    expect(prefs().activeModelId).toBe('image')
    const persisted = storage.getItem('happychat-prefs')!
    useChatPrefs.setState(useChatPrefs.getInitialState())
    storage.setItem('happychat-prefs', persisted)
    await useChatPrefs.persist.rehydrate()
    prefs().resetActive({})
    expect(prefs().activeModelId).toBe('preferred')
  })
})
