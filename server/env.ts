import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATA_DIR: z.string().min(1).default('./data'),
  DATABASE_URL: z.string().min(1).default('./data/happychat.db'),
  // 开发环境提供占位默认值以便零配置启动；生产环境必须显式设置。
  SESSION_SECRET: z.string().min(16).default('dev-insecure-session-secret-change-me'),
  APP_ENCRYPTION_KEY: z.string().min(16).default('dev-insecure-encryption-key-change-me'),
  UPSTREAM_BASE_URL: z.string().url().optional(),
  UPSTREAM_API_KEY: z.string().optional(),
})

function loadEnv() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('环境变量校验失败：', z.treeifyError(parsed.error))
    process.exit(1)
  }
  const env = parsed.data
  if (env.NODE_ENV === 'production') {
    if (env.SESSION_SECRET.startsWith('dev-') || env.APP_ENCRYPTION_KEY.startsWith('dev-')) {
      console.error('生产环境必须设置高强度的 SESSION_SECRET 与 APP_ENCRYPTION_KEY。')
      process.exit(1)
    }
  }
  return env
}

export const env = loadEnv()
export type Env = typeof env
