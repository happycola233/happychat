import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_SIDEBAR_STORAGE_KEY,
  readPersistedAdminSidebarCollapsed,
} from './adminSidebar'

function installMemoryStorage() {
  const map = new Map<string, string>()
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  return storage
}

describe('readPersistedAdminSidebarCollapsed', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('没有存储或存储不可用时默认展开', () => {
    expect(readPersistedAdminSidebarCollapsed()).toBe(false)
    installMemoryStorage()
    expect(readPersistedAdminSidebarCollapsed()).toBe(false)
  })

  it('只把明确的 true 当成折叠', () => {
    const storage = installMemoryStorage()
    storage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, '{"state":{"collapsed":true}}')
    expect(readPersistedAdminSidebarCollapsed()).toBe(true)

    storage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, '{"state":{"collapsed":"yes"}}')
    expect(readPersistedAdminSidebarCollapsed()).toBe(false)

    storage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, '{not-json')
    expect(readPersistedAdminSidebarCollapsed()).toBe(false)
  })
})
