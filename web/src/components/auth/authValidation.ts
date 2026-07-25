import type { ZodType } from 'zod'
import { passwordSchema, usernameSchema } from '@shared/schemas/auth'

/**
 * 提交前的字段校验直接复用 `@shared/schemas/auth` 的 zod schema——
 * 服务端用同一份规则拒绝请求，这里只是把同样的中文提示提前显示在字段下方，
 * 前端不重复描述「几位、允许哪些字符」，规则改动也不会两处走样。
 */
function firstIssueMessage(schema: ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error.issues[0]?.message
}

export const validateUsername = (value: string): string | undefined =>
  firstIssueMessage(usernameSchema, value)

export const validatePassword = (value: string): string | undefined =>
  firstIssueMessage(passwordSchema, value)
