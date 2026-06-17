// P4：纯文本渲染（保留换行）。助手消息走 Markdown 组件，用户消息用这里。
export function MessageText({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-7 break-words whitespace-pre-wrap text-neutral-800 dark:text-neutral-100">
      {text}
    </div>
  )
}
