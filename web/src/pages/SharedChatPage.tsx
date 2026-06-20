import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { textFromContent } from '@shared/util/contentText'
import type { ContentPart } from '@shared/types/domain'
import type { MessageDTO } from '@shared/types/api'
import { getPublicShare, shareAttachmentUrl } from '../api/shares'
import { Markdown } from '../chat/Markdown'
import { ReasoningCard } from '../chat/ReasoningCard'
import { Spinner } from '../components/ui/Spinner'

function imageParts(content: ContentPart[]) {
  return content.filter(
    (p): p is Extract<ContentPart, { type: 'input_image' | 'image_result' }> =>
      p.type === 'input_image' || p.type === 'image_result',
  )
}

function SharedMessage({ m, token }: { m: MessageDTO; token: string }) {
  const text = textFromContent(m.content)
  const images = imageParts(m.content)

  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {images.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
            {images.map((p) => (
              <img
                key={p.attachment_id}
                src={shareAttachmentUrl(token, p.attachment_id)}
                alt=""
                className="max-h-60 rounded-xl border border-neutral-200 dark:border-neutral-700"
              />
            ))}
          </div>
        )}
        {text && (
          <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
            {text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {m.reasoningSummary && (
        <ReasoningCard
          text={m.reasoningSummary}
          status="completed"
          startedAt={null}
          durationMs={m.reasoningDurationMs}
          defaultExpanded={false}
        />
      )}
      {text && <Markdown text={text} />}
      {images.map((p) => (
        <a
          key={p.attachment_id}
          href={shareAttachmentUrl(token, p.attachment_id)}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={shareAttachmentUrl(token, p.attachment_id)}
            alt="生成的图片"
            className="max-h-96 rounded-xl border border-neutral-200 dark:border-neutral-700"
          />
        </a>
      ))}
    </div>
  )
}

export default function SharedChatPage() {
  const { token } = useParams()
  const {
    data: share,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['public-share', token],
    queryFn: () => getPublicShare(token!),
    enabled: !!token,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-neutral-900">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    )
  }

  if (isError || !share) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-4 text-center dark:bg-neutral-900">
        <h1 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
          分享不存在或已失效
        </h1>
        <Link to="/" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
          前往 HappyChat
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-white dark:bg-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {share.owner.avatarUrl ? (
            <img src={share.owner.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {share.title ?? '分享的对话'}
            </div>
            {share.owner.name && (
              <div className="truncate text-xs text-neutral-400">来自 {share.owner.name}</div>
            )}
          </div>
          <Link
            to="/"
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            HappyChat
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {share.messages.map((m) => (
          <SharedMessage key={m.id} m={m} token={token!} />
        ))}
      </main>

      <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
        本页为只读分享 · 由 HappyChat 生成
      </footer>
    </div>
  )
}
