import type { users } from '../db/schema'

/** 内部使用的完整用户行（含 passwordHash，切勿直接返回前端） */
export type AuthUser = typeof users.$inferSelect

/** Hono 应用的上下文变量类型 */
export type AppEnv = {
  Variables: {
    user: AuthUser
  }
}
