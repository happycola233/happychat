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
const lastAnimatedTitles = new Map<string, string>()

function clearTimer(conversationId: string): void {
  const timer = timers.get(conversationId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(conversationId)
  }
}

/** 按用户眼中的字符切分，避免 emoji 在逐字过程中短暂显示成半个代理项。 */
function splitTitleCharacters(title: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(title), ({ segment }) => segment)
  }
  return Array.from(title)
}

/** 只负责标题生成后的视觉打字效果；真实标题仍以 TanStack Query 缓存为准。 */
export const useTitleTypingStore = create<TitleTypingStore>((set) => ({
  byConversation: {},
  start: (conversationId, title) => {
    // SSE 与补偿轮询可能先后送达同一标题；动画层保证同一结果只播放一次。
    if (title && lastAnimatedTitles.get(conversationId) === title) return
    clearTimer(conversationId)
    if (!title) {
      lastAnimatedTitles.delete(conversationId)
      set((state) => {
        const next = { ...state.byConversation }
        delete next[conversationId]
        return { byConversation: next }
      })
      return
    }

    lastAnimatedTitles.set(conversationId, title)
    const titleCharacters = splitTitleCharacters(title)
    let visibleCharacterCount = Math.min(1, titleCharacters.length)
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: {
          text: titleCharacters.slice(0, visibleCharacterCount).join(''),
          active: true,
        },
      },
    }))

    const tick = () => {
      visibleCharacterCount += 1
      if (visibleCharacterCount <= titleCharacters.length) {
        set((state) => ({
          byConversation: {
            ...state.byConversation,
            [conversationId]: {
              text: titleCharacters.slice(0, visibleCharacterCount).join(''),
              active: true,
            },
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
    lastAnimatedTitles.delete(conversationId)
    set((state) => {
      const next = { ...state.byConversation }
      delete next[conversationId]
      return { byConversation: next }
    })
  },
}))
