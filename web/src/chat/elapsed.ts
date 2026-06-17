export function elapsedSeconds(startedAt: number | null): number {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}
