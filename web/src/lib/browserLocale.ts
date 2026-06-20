/** 返回浏览器当前首选语言；服务端异步任务会用它决定标题语言。 */
export function getBrowserLocale(): string | undefined {
  const languages = globalThis.navigator?.languages
  return languages?.find((lang) => lang.trim()) ?? globalThis.navigator?.language ?? undefined
}
