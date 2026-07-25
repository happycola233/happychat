/**
 * 构建信息：由 Vite `define` 注入（见 vite.config.ts）。
 * vitest 等不走 Vite 前端配置的环境没有这些全局常量，因此统一在这里做一次兜底，
 * 调用方可以直接当普通常量使用。
 */

/** 应用版本号，取自 package.json。 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

/** 构建时间戳（毫秒）；无法获取时为 null。 */
export const BUILD_TIME: number | null = (() => {
  if (typeof __BUILD_TIME__ !== 'string') return null
  const ts = Date.parse(__BUILD_TIME__)
  return Number.isNaN(ts) ? null : ts
})()
