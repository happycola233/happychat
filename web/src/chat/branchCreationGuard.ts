/**
 * 浏览器会先连续派发两次 click，之后才派发 dblclick。若首个分支请求在第二次 click
 * 前已经返回并完成导航，仅靠组件内的 pending 状态仍可能再次创建分支。
 *
 * 模块级时间门可跨路由重渲染/组件重挂载，且只拦截人类双击所处的短窗口；请求期间的
 * 长时间互斥仍由 ChatView 的同步 ref 负责。
 */
export const BRANCH_CREATION_COOLDOWN_MS = 700

let blockedUntil = 0

export function beginBranchCreationCooldown(now = Date.now()): boolean {
  if (now < blockedUntil) return false
  blockedUntil = now + BRANCH_CREATION_COOLDOWN_MS
  return true
}
