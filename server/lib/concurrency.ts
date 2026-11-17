/**
 * 进程内并发闸门：同时最多运行 max 个任务，其余按到达顺序排队。
 * 任务结束时名额直接交给队首，避免新任务插队导致并发超额。
 */
export function createConcurrencyLimit(max: number) {
  let availableSlots = max
  const waitingTasks: (() => void)[] = []

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (availableSlots > 0) availableSlots--
    else await new Promise<void>((resolve) => waitingTasks.push(resolve))
    try {
      return await task()
    } finally {
      const next = waitingTasks.shift()
      if (next) next()
      else availableSlots++
    }
  }
}
