import { isIOSLikePlatform, type NavigatorLike } from './platform'

export interface ClientEnvInfo {
  /** 形如 "Chrome 141"，识别失败时为 "未知浏览器"。 */
  browser: string
  /** 形如 "Windows 10/11"、"iOS 18"，识别失败时为 "未知系统"。 */
  os: string
}

/**
 * 浏览器识别规则：顺序敏感。
 * Edge / Opera / Vivaldi / Samsung 的 UA 同时包含 Chrome，必须排在 Chrome 之前；
 * Safari 放最后，靠 `Version/x … Safari` 组合与 Chromium 系区分。
 */
const BROWSER_RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /OPR\/(\d+)/ },
  { name: 'Vivaldi', pattern: /Vivaldi\/(\d+)/ },
  { name: '三星浏览器', pattern: /SamsungBrowser\/(\d+)/ },
  { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Safari', pattern: /Version\/(\d+)[\d._]*\s+(?:Mobile\/\S+\s+)?Safari/ },
]

/** Windows NT 版本号 → 面向用户的名称（NT 10.0 无法区分 10 与 11）。 */
const WINDOWS_NT_NAMES: Record<string, string> = {
  '10.0': 'Windows 10/11',
  '6.3': 'Windows 8.1',
  '6.2': 'Windows 8',
  '6.1': 'Windows 7',
}

/** 从 UA 提取「浏览器 + 主版本号」。 */
export function describeBrowser(userAgent: string): string {
  for (const rule of BROWSER_RULES) {
    const matched = rule.pattern.exec(userAgent)
    if (matched) return `${rule.name} ${matched[1]}`
  }
  return '未知浏览器'
}

/** 从 UA / platform 推断操作系统；iPadOS 桌面模式借助触摸点判断。 */
export function describeOS(source: NavigatorLike): string {
  const userAgent = source.userAgent ?? ''

  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    const version = /OS (\d+)[._](\d+)/.exec(userAgent)
    return version ? `iOS ${version[1]}.${version[2]}` : 'iOS'
  }
  // UA 里没有 iPhone/iPad，但 platform 报 MacIntel 且有多点触控 → iPadOS 桌面模式。
  if (isIOSLikePlatform(source)) return 'iPadOS'

  const android = /Android (\d+(?:\.\d+)?)/.exec(userAgent)
  if (android) return `Android ${android[1]}`

  const windows = /Windows NT ([\d.]+)/.exec(userAgent)
  if (windows) return WINDOWS_NT_NAMES[windows[1] ?? ''] ?? 'Windows'

  if (/CrOS/.test(userAgent)) return 'ChromeOS'

  const mac = /Mac OS X (\d+)[._](\d+)/.exec(userAgent)
  if (mac) {
    const [, major = '', minor = ''] = mac
    // macOS 11 起各浏览器都把 UA 版本冻结在 10.15（Safari 报 10_15_7），此时数字毫无参考价值，
    // 只有 10.15 之前的号段才是设备真实版本。
    const frozen = major === '10' && Number(minor) >= 15
    return frozen ? 'macOS' : `macOS ${major}.${minor}`
  }
  if (/Macintosh/.test(userAgent)) return 'macOS'

  if (/Linux/.test(userAgent)) return 'Linux'

  return '未知系统'
}

/** 汇总当前客户端的浏览器与系统信息，用于「关于」页展示与反馈时复制。 */
export function describeClientEnv(source: NavigatorLike = navigator): ClientEnvInfo {
  const userAgent = source.userAgent ?? ''
  return { browser: describeBrowser(userAgent), os: describeOS(source) }
}
