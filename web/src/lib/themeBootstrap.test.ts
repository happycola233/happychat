/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')
const bootstrapMatch = indexHtml.match(/<script data-hc-theme-bootstrap>([\s\S]*?)<\/script>/)

if (!bootstrapMatch?.[1]) {
  throw new Error('index.html 缺少首帧主题引导脚本')
}

const bootstrapScript = new Script(bootstrapMatch[1])

interface BootstrapScenario {
  systemDark: boolean
  cachedValue?: string
  storageThrows?: boolean
}

function runBootstrap({ systemDark, cachedValue, storageThrows }: BootstrapScenario): boolean {
  let darkEnabled = false

  bootstrapScript.runInNewContext({
    window: {
      localStorage: {
        getItem: (key: string) => {
          if (storageThrows) throw new Error('localStorage unavailable')
          return key === 'happychat-settings' ? (cachedValue ?? null) : null
        },
      },
      matchMedia: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' && systemDark,
      }),
    },
    document: {
      documentElement: {
        classList: {
          toggle: (className: string, enabled: boolean) => {
            if (className === 'dark') darkEnabled = enabled
          },
        },
      },
    },
  })

  return darkEnabled
}

function persistedTheme(theme: 'light' | 'dark' | 'system'): string {
  return JSON.stringify({ state: { theme }, version: 0 })
}

describe('首帧主题引导', () => {
  it.each([
    { name: '无缓存时跟随系统深色', systemDark: true, expected: true },
    { name: '无缓存时跟随系统浅色', systemDark: false, expected: false },
    {
      name: '系统深色时尊重缓存的强制浅色',
      systemDark: true,
      cachedValue: persistedTheme('light'),
      expected: false,
    },
    {
      name: '系统浅色时尊重缓存的强制深色',
      systemDark: false,
      cachedValue: persistedTheme('dark'),
      expected: true,
    },
    {
      name: '缓存为跟随系统时使用系统主题',
      systemDark: true,
      cachedValue: persistedTheme('system'),
      expected: true,
    },
    {
      name: '缓存损坏时安全回退到系统主题',
      systemDark: true,
      cachedValue: '{broken-json',
      expected: true,
    },
    {
      name: '缓存主题值未知时安全回退到系统主题',
      systemDark: true,
      cachedValue: JSON.stringify({ state: { theme: 'sepia' }, version: 0 }),
      expected: true,
    },
    {
      name: 'localStorage 不可用时安全回退到系统主题',
      systemDark: true,
      storageThrows: true,
      expected: true,
    },
  ])('$name', ({ systemDark, cachedValue, storageThrows, expected }) => {
    expect(runBootstrap({ systemDark, cachedValue, storageThrows })).toBe(expected)
  })

  it('在主应用脚本之前执行，并提供同步的深浅背景', () => {
    expect(indexHtml.indexOf('data-hc-theme-bootstrap')).toBeLessThan(
      indexHtml.indexOf('/src/main.tsx'),
    )
    expect(indexHtml).toMatch(/html\.dark body\s*{\s*background-color: #000000;/)
    expect(indexHtml).toMatch(/body\s*{\s*background-color: #ffffff;/)
  })
})
