import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import type { LiveImageGeneration, LiveMessage, LiveStatus } from '../sse/eventReducer'
import { attachmentUrl } from '../api/attachments'
import { ElapsedLabel } from './ElapsedLabel'
import { ImagePreviewTrigger } from './ImagePreview'

interface Props {
  live: LiveMessage
}

export function ProgressiveImageStage({ live }: Props) {
  const generations = live.imageGenerations.length
    ? live.imageGenerations
    : legacyImageGeneration(live)
  if (!generations.length) return null

  const ordered = [...generations].sort((a, b) => a.index - b.index)
  if (ordered.length === 1) {
    const first = ordered[0]
    if (!first) return null
    return (
      <ProgressiveImageCard
        generation={first}
        total={1}
        liveStatus={live.status}
        className="w-[min(18rem,100%)] sm:w-[min(24rem,100%)]"
      />
    )
  }

  return (
    <div className="grid w-[min(40rem,100%)] grid-cols-1 items-start gap-3 sm:grid-cols-2">
      {ordered.map((generation) => (
        <ProgressiveImageCard
          key={generation.id}
          generation={generation}
          total={ordered.length}
          liveStatus={live.status}
          className="w-full"
        />
      ))}
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
  className,
}: {
  generation: LiveImageGeneration
  total: number
  liveStatus: LiveStatus
  className?: string
}) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const finalId = generation.attachmentId
  const previewId = generation.previewAttachmentId
  const activeId = finalId || previewId
  const activeUrl = activeId ? attachmentUrl(activeId) : null
  const done = generation.status === 'done' && Boolean(finalId)
  const active = liveStatus === 'streaming' && !done
  const previewLabel =
    generation.previewIndex === null || generation.previewIndex === undefined
      ? '生成中'
      : `预览 ${generation.previewIndex + 1}`
  const imageLabel = total > 1 ? `图 ${generation.index + 1}` : ''
  const statusLabel = done
    ? total > 1
      ? `${imageLabel} 完成`
      : '已完成'
    : active
      ? total > 1
        ? `${imageLabel} · ${previewId ? previewLabel : '生成中'}`
        : previewId
          ? previewLabel
          : '生成图片'
      : total > 1
        ? `${imageLabel} 已停止`
        : '已停止'

  useEffect(() => {
    setAspectRatio(null)
  }, [activeId])

  return (
    <div
      className={clsx(
        'hc-image-stage relative',
        'bg-neutral-50 text-neutral-500',
        'dark:bg-neutral-900 dark:text-neutral-300',
        className,
      )}
    >
      <div
        className="hc-image-stage-body relative aspect-square"
        style={aspectRatio ? { aspectRatio } : undefined}
      >
        {activeUrl && (
          <div className="hc-image-stage-media absolute inset-0 block">
            <ImagePreviewTrigger
              src={activeUrl}
              alt={done ? '模型生成的图片' : '生成图片预览'}
              caption={generation.revisedPrompt}
              title={generation.revisedPrompt}
              className="h-full w-full overflow-hidden rounded-[inherit]"
            >
              <img
                key={`${activeId}-${generation.previewUpdatedAt ?? 0}-${done ? 'final' : 'preview'}`}
                src={activeUrl}
                alt="生成的图片"
                title={generation.revisedPrompt}
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setAspectRatio(image.naturalWidth / image.naturalHeight)
                  }
                }}
                className={clsx(
                  'hc-progressive-image absolute inset-0 h-full w-full object-cover',
                  done ? 'hc-progressive-image-final' : 'hc-progressive-image-preview',
                )}
              />
            </ImagePreviewTrigger>
          </div>
        )}
        {active && <div className="hc-image-stage-scan pointer-events-none absolute inset-0" />}
      </div>
      <div className="hc-image-stage-status flex items-center justify-between gap-3 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-2 font-medium">
          {done ? (
            <>
              <Check className="h-3.5 w-3.5" />
              已完成
            </>
          ) : (
            <>
              {active && <span className="hc-image-stage-dot" />}
              {statusLabel}
            </>
          )}
        </span>
        <ElapsedLabel prefix={active ? '已用' : '耗时'} startedAt={generation.startedAt} active={active} />
      </div>
    </div>
  )
}
