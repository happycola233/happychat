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

/** 首个可见正文 delta；元数据与推理摘要不属于“首字”。 */
export const FIRST_OUTPUT_TOKEN_EVENT_TYPE = 'response.output_text.delta'

/** 从生成引擎起点到首个可见正文 delta 的墙钟延时。 */
export function computeFirstTokenLatencyMs(
  startedAt: Date | null,
  firstOutputAtMs: number | null,
): number | null {
  if (!startedAt || firstOutputAtMs === null) return null
  return Math.max(0, firstOutputAtMs - startedAt.getTime())
}

/**
 * 与常见请求监控面板一致：输出 Token 数除以首字出现后的生成时长。
 * outputTokens 沿用上游口径，其中可能包含 reasoning tokens。
 */
export function computeGenerationTokensPerSecond(
  outputTokens: number,
  durationMs: number | null,
  firstTokenLatencyMs: number | null,
): number | null {
  if (outputTokens <= 0 || durationMs === null || firstTokenLatencyMs === null) return null
  const generationDurationMs = durationMs - firstTokenLatencyMs
  if (generationDurationMs <= 0) return null
  return outputTokens / (generationDurationMs / 1000)
}
