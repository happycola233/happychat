/**
 * 注册页密码强度的评分口径（纯逻辑，展示见 `PasswordStrengthMeter.tsx`）。
 * 只是「写得更安全一点」的引导，不参与提交校验——真正的下限由
 * `@shared/schemas/auth` 的 `passwordSchema`（至少 6 位）在两端强制。
 */

/** 0 = 空（不展示指示条）；1 弱 / 2 一般 / 3 较强 / 4 很强。 */
export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4

/** 强度档数，同时是指示条的段数。 */
export const PASSWORD_STRENGTH_LEVELS = 4

/** 统计密码用到的字符种类数（小写 / 大写 / 数字 / 其他），种类越多越难被穷举。 */
function countCharClasses(password: string): number {
  let classes = 0
  if (/[a-z]/.test(password)) classes += 1
  if (/[A-Z]/.test(password)) classes += 1
  if (/[0-9]/.test(password)) classes += 1
  // 剩下的一律算「符号」，包含中文等非 ASCII 字符。
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1
  return classes
}

/**
 * 长度与字符种类分别加分后归到四档：长度是主因（阈值 6 / 10 / 14），混用字符种类再加两分。
 * 因此 14 位纯小写与 10 位「大小写 + 数字」都能到「较强」以上，
 * 而刚够 6 位的单一类型密码只能拿到「弱」。第 4 种字符类型不再额外加分，
 * 避免鼓励「8 位但塞满符号」这类实际上仍易破解的密码。
 */
export function scorePasswordStrength(password: string): PasswordStrengthScore {
  if (!password) return 0
  if (password.length < 6) return 1

  let score = 1
  if (password.length >= 10) score += 1
  if (password.length >= 14) score += 1

  const classes = countCharClasses(password)
  if (classes >= 2) score += 1
  if (classes >= 3) score += 1

  return Math.min(score, PASSWORD_STRENGTH_LEVELS) as PasswordStrengthScore
}
