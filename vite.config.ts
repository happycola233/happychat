import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// 单仓库（非 monorepo）：前端根目录为 web/，通过 alias 引用根级 shared/。
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
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
