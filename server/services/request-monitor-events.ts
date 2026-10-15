type Listener = () => void

const listeners = new Set<Listener>()

/** 管理端只接收失效通知，再按当前筛选读取快照；事件中不携带聊天或错误原文。 */
export const requestMonitorEvents = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  notify(): void {
    listeners.forEach((listener) => listener())
  },
}
