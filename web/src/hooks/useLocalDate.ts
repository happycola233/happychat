import { useSyncExternalStore } from 'react'

function readLocalDate() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return { today: date.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

let snapshot = readLocalDate()
const listeners = new Set<() => void>()
let midnightTimer: ReturnType<typeof setTimeout> | undefined

function refresh() {
  const next = readLocalDate()
  if (next.today !== snapshot.today || next.timeZone !== snapshot.timeZone) {
    snapshot = next
    listeners.forEach((listener) => listener())
  }
  clearTimeout(midnightTimer)
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  midnightTimer = setTimeout(refresh, midnight.getTime() - Date.now())
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    // 全部消息共用一个午夜计时器；从后台恢复时重新读取日期和设备时区。
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(midnightTimer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

const getSnapshot = () => snapshot

export function useLocalDate() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
