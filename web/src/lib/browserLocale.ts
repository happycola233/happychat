/** 返回浏览器当前首选语言；服务端异步任务会用它决定标题语言。 */
export function getBrowserLocale(): string | undefined {
  const languages = globalThis.navigator?.languages
  return languages?.find((lang) => lang.trim()) ?? globalThis.navigator?.language ?? undefined
}

/** 返回浏览器当前 IANA 时区；不可用时交由服务端回退。 */
export function getBrowserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}
