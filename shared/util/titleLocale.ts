const FALLBACK_TITLE_LOCALE = '简体中文'

function canonicalLocale(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null
  } catch {
    return null
  }
}

/** 把浏览器 BCP 47 语言标签转成适合放进标题提示词的语言描述。 */
export function titleLocaleFromBrowser(raw: unknown): string {
  const locale = canonicalLocale(raw)
  if (!locale) return FALLBACK_TITLE_LOCALE

  const lower = locale.toLowerCase()
  if (
    lower === 'zh' ||
    lower === 'zh-cn' ||
    lower === 'zh-sg' ||
    lower.startsWith('zh-hans')
  ) {
    return '简体中文'
  }
  if (
    lower === 'zh-tw' ||
    lower === 'zh-hk' ||
    lower === 'zh-mo' ||
    lower.startsWith('zh-hant')
  ) {
    return '繁體中文'
  }

  const display = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale)
  return display ? `${display} (${locale})` : locale
}
