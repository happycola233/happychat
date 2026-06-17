export interface RunEvent {
  runId: string
  sequenceNumber: number
  type: string
  data: Record<string, unknown>
}

type Listener = (ev: RunEvent) => void

/** 进程内每 run 的发布订阅：引擎产出事件，SSE 订阅者实时接收。 */
class RunEmitter {
  private subs = new Map<string, Set<Listener>>()

  subscribe(runId: string, fn: Listener): () => void {
    let set = this.subs.get(runId)
    if (!set) {
      set = new Set()
      this.subs.set(runId, set)
    }
    set.add(fn)
    return () => {
      const s = this.subs.get(runId)
      if (!s) return
      s.delete(fn)
      if (s.size === 0) this.subs.delete(runId)
    }
  }

  emit(ev: RunEvent): void {
    this.subs.get(ev.runId)?.forEach((fn) => fn(ev))
  }
}

export const runEmitter = new RunEmitter()
