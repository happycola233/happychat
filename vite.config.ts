import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 版本号唯一来源是 package.json，避免前端再硬编码一份导致发版后忘记同步。
const { version: appVersion } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

// 单仓库（非 monorepo）：前端根目录为 web/，通过 alias 引用根级 shared/。
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  // 构建期常量（类型声明见 web/src/env.d.ts）：开发模式下 __BUILD_TIME__ 即 dev server 启动时间。
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    // 绑定所有接口（含 IPv4），避免 Windows 下仅绑定 IPv6 [::1] 导致 127.0.0.1 无法访问。
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // 把 /api 代理到 Hono 后端；SSE 流式由后端设置 no-transform / X-Accel-Buffering 保证不被缓冲。
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
