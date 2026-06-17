/** 断言数据库返回的记录存在，否则抛错（用于 insert().returning() 等必然返回的场景）。 */
export function must<T>(v: T | undefined | null, message = '记录不存在'): T {
  if (v === undefined || v === null) throw new Error(message)
  return v
}
