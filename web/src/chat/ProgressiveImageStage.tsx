import { useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Gamepad2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { ContentPart } from '@shared/types/domain'
import type { LiveImageGeneration, LiveMessage, LiveStatus } from '../sse/eventReducer'
import { attachmentUrl } from '../api/attachments'
import { ElapsedLabel } from './ElapsedLabel'
import { ImageWaitingGame } from './ImageWaitingGame'
import { ProgressiveImageMedia } from './ProgressiveImageMedia'
import { EditIcon } from './icons'
import type { ImageEditSource } from './imageSource'

interface Props {
  live: LiveMessage
  completedImages?: Extract<ContentPart, { type: 'image_result' }>[]
  onUseImageSource?: (source: ImageEditSource) => void
}

export function ProgressiveImageStage({ live, completedImages, onUseImageSource }: Props) {
  const [gameGenerationId, setGameGenerationId] = useState<string | null>(null)
  const gameId = useId()
  const generations = live.imageGenerations.length
    ? live.imageGenerations
    : legacyImageGeneration(live)
  if (!generations.length) return null

  // 并发生图的入库顺序可能是完成顺序，已有最终附件必须按 ID 匹配，不能按数组位置覆盖。
  const pendingFinalImages = completedImages?.filter(
    (image) => !generations.some((generation) => generation.attachmentId === image.attachment_id),
  )
  const ordered = [...generations]
    .sort((a, b) => a.index - b.index)
    .map((generation) => {
      const finalImage = generation.attachmentId
        ? completedImages?.find((image) => image.attachment_id === generation.attachmentId)
        : pendingFinalImages?.shift()
      return finalImage
        ? {
            ...generation,
            status: 'done' as const,
            attachmentId: finalImage.attachment_id,
            revisedPrompt: finalImage.revised_prompt ?? generation.revisedPrompt,
          }
        : generation
    })
  const active = live.status === 'streaming' && ordered.some((image) => image.status !== 'done')
  const waitingForRetry = live.retry?.phase === 'waiting'
  // 一局跟随打开时的图片；该图完成就收起，避免多图完成时把游戏搬到另一张图并重开。
  const gameExpanded =
    active && ordered.some((image) => image.id === gameGenerationId && image.status !== 'done')

  return (
    <div className={ordered.length === 1 ? 'w-[min(24rem,100%)]' : 'w-[min(40rem,100%)]'}>
      <div
        className={clsx(
          'grid grid-cols-1 items-start gap-4',
          ordered.length > 1 && 'sm:grid-cols-2',
        )}
      >
        {ordered.map((generation) => (
          <ProgressiveImageCard
            key={generation.id}
            generation={generation}
            total={ordered.length}
            liveStatus={live.status}
            waitingForRetry={waitingForRetry}
            onUseImageSource={onUseImageSource}
            game={
              gameExpanded && generation.id === gameGenerationId ? (
                <div id={gameId}>
                  <ImageWaitingGame />
                </div>
              ) : undefined
            }
          />
        ))}
      </div>
      {active && (
        <div className="mt-1.5 w-[min(24rem,100%)]">
          <button
            type="button"
            aria-expanded={gameExpanded}
            aria-controls={gameId}
            onClick={() =>
              setGameGenerationId(
                gameExpanded ? null : ordered.find((image) => image.status !== 'done')!.id,
              )
            }
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-xs text-neutral-400 transition hover:bg-black/[0.035] hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <Gamepad2 className="h-3.5 w-3.5" />
            {gameExpanded ? '返回图片' : '玩贪吃蛇'}
            <ChevronDown
              className={clsx('h-3 w-3 transition-transform', gameExpanded && 'rotate-180')}
            />
          </button>
        </div>
      )}
    </div>
  )
}

function legacyImageGeneration(live: LiveMessage): LiveImageGeneration[] {
  if (!live.imageStatus) return []
  return [
    {
      id: 'image-0',
      index: 0,
      outputIndex: null,
      status: live.imageStatus === 'done' ? 'done' : 'generating',
      attachmentId: live.imageAttachmentId,
      previewAttachmentId: live.imagePreviewAttachmentId,
      previewIndex: live.imagePreviewIndex,
      previewUpdatedAt: live.imagePreviewUpdatedAt,
      revisedPrompt: live.imageRevisedPrompt,
      startedAt: live.imageStartedAt,
      completedAt: null,
    },
  ]
}

function ProgressiveImageCard({
  generation,
  total,
  liveStatus,
  waitingForRetry,
  onUseImageSource,
  game,
}: {
  generation: LiveImageGeneration
  total: number
  liveStatus: LiveStatus
  waitingForRetry: boolean
  onUseImageSource?: (source: ImageEditSource) => void
  game?: ReactNode
}) {
  const finalId = generation.attachmentId
  const previewId = generation.previewAttachmentId
  const activeId = finalId || previewId
  const activeUrl = activeId ? attachmentUrl(activeId) : null
  const done = generation.status === 'done' && Boolean(finalId)
  const active = liveStatus === 'streaming' && !done
  const generationProgressLabel =
    generation.previewIndex === null || generation.previewIndex === undefined
      ? '正在完善细节'
      : `仍在生成（阶段 ${generation.previewIndex + 1}）`
  const imageLabel = total > 1 ? `图 ${generation.index + 1}` : ''
  const statusLabel = done
    ? total > 1
      ? `${imageLabel} 完成`
      : '已完成'
    : active
      ? total > 1
        ? `${imageLabel} · ${previewId ? generationProgressLabel : '生成中'}`
        : previewId
          ? generationProgressLabel
          : '正在生成图片'
      : total > 1
        ? `${imageLabel} 已停止`
        : '已停止'

  return (
    <div className="hc-image-stage relative w-full text-neutral-500 dark:text-neutral-400">
      <div className="flex min-h-8 items-center justify-between gap-3 text-[13px]">
        <span role="status" className="inline-flex min-w-0 items-center gap-1.5">
          {done && <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />}
          {waitingForRetry && active ? '等待重试' : statusLabel}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
          {done && generation.completedAt !== null && generation.startedAt !== null ? (
            `耗时 ${Math.max(0, Math.floor((generation.completedAt - generation.startedAt) / 1000))}s`
          ) : (
            <ElapsedLabel
              prefix={active ? '已用' : '耗时'}
              startedAt={generation.startedAt}
              active={active}
            />
          )}
        </span>
      </div>
      {(activeUrl || active) && (
        // 保持媒体组件挂载，游戏期间照常下载与解码预览，返回时无需重新加载。
        <div hidden={Boolean(game)}>
          <ProgressiveImageMedia
            src={activeUrl}
            done={done}
            active={active && !waitingForRetry && !game}
            caption={generation.revisedPrompt}
          />
        </div>
      )}
      {game}
      {done && finalId && onUseImageSource && (
        <button
          type="button"
          onClick={() =>
            onUseImageSource({ attachmentId: finalId, label: `生成图 ${generation.index + 1}` })
          }
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          title="以此图编辑"
        >
          <EditIcon className="h-3.5 w-3.5" />
          以此图编辑
        </button>
      )}
    </div>
  )
}
