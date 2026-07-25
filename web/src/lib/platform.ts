/**
 * 平台/环境识别所需的最小 navigator 子集，便于单测注入。
 * 平台判断（本文件）与浏览器/系统描述（clientEnv.ts）共用同一个入参形状，避免两处各定义一份。
 */
export interface NavigatorLike {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}

const IOS_DEVICE_RE = /iPad|iPhone|iPod/i

export function isIOSLikePlatform(info: NavigatorLike = navigator): boolean {
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
