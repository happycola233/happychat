import { zValidator } from '@hono/zod-validator'
import type { ZodType } from 'zod'

/** 统一的 JSON 请求体校验器：校验失败时返回中文错误。 */
export function jsonValidator<T extends ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const first = result.error.issues[0]
      return c.json(
        { error: { message: first?.message ?? '请求参数有误', code: 'invalid_request' } },
        400,
      )
    }
    return undefined
  })
}
