/**
 * 计算一次生成的墙钟耗时。
 *
 * run 可能因旧数据或关联记录被删除而缺少起止时间，此时调用方应展示为未知，
 * 而不是把它误报成 0 毫秒。
 */
export function computeGenerationDurationMs(
  startedAt: Date | null,
  finishedAt: Date | null,
): number | null {
  if (!startedAt || !finishedAt) return null
  return Math.max(0, finishedAt.getTime() - startedAt.getTime())
}
