/**
 * 同源附件响应的安全头。SVG 是可执行脚本的 XML 文档：经 <img> 展示时不会执行，
 * 但用户在新标签页直接打开时会作为本站页面解析，因此一律放进无脚本沙箱。
 */
export function attachmentSecurityHeaders(mime: string): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    ...(mime === 'image/svg+xml'
      ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
      : {}),
  }
}
