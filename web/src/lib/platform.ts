interface PlatformInfo {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}

const IOS_DEVICE_RE = /iPad|iPhone|iPod/i

export function isIOSLikePlatform(info: PlatformInfo = navigator): boolean {
  const platform = info.platform ?? ''
  const userAgent = info.userAgent ?? ''
  const maxTouchPoints = info.maxTouchPoints ?? 0

  // iPadOS 的桌面模式会把 platform 报成 MacIntel，只能结合触摸点判断。
  return (
    IOS_DEVICE_RE.test(platform) ||
    IOS_DEVICE_RE.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  )
}

export function applyPlatformClasses() {
  document.documentElement.classList.toggle('hc-ios', isIOSLikePlatform())
}
