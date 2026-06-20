import { create } from 'zustand'

interface TypingTitle {
  text: string
  active: boolean
}

interface TitleTypingStore {
  byConversation: Record<string, TypingTitle>
  start: (conversationId: string, title: string) => void
  clear: (conversationId: string) => void
}

const TYPE_INTERVAL_MS = 48
const HOLD_AFTER_DONE_MS = 900
const timers = new Map<string, number>()

function clearTimer(conversationId: string): void {
  const timer = timers.get(conversationId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(conversationId)
  }
}

/** 只负责标题生成后的视觉打字效果；真实标题仍以 TanStack Query 缓存为准。 */
export const useTitleTypingStore = create<TitleTypingStore>((set) => ({
  byConversation: {},
  start: (conversationId, title) => {
    clearTimer(conversationId)
    if (!title) {
      set((state) => {
        const next = { ...state.byConversation }
        delete next[conversationId]
        return { byConversation: next }
      })
      return
    }

    let index = Math.min(1, title.length)
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: { text: title.slice(0, index), active: true },
      },
    }))

    const tick = () => {
      index += 1
      if (index <= title.length) {
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [conversationId]: { text: title.slice(0, index), active: true },
          },
        }))
        timers.set(conversationId, window.setTimeout(tick, TYPE_INTERVAL_MS))
        return
      }

      timers.set(
        conversationId,
        window.setTimeout(() => {
          timers.delete(conversationId)
          set((state) => {
            const next = { ...state.byConversation }
            delete next[conversationId]
            return { byConversation: next }
          })
        }, HOLD_AFTER_DONE_MS),
      )
    }

    timers.set(conversationId, window.setTimeout(tick, TYPE_INTERVAL_MS))
  },
  clear: (conversationId) => {
    clearTimer(conversationId)
    set((state) => {
      const next = { ...state.byConversation }
      delete next[conversationId]
      return { byConversation: next }
    })
  },
}))
