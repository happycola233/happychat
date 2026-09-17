import { useEffect, useState, type CSSProperties } from 'react'
import { Maximize2 } from 'lucide-react'
import { clsx } from 'clsx'
import { ImageGenerationDots } from './ImageGenerationDots'
import { ImagePreviewTrigger } from './ImagePreview'
import { loadProgressiveImage } from './loadProgressiveImage'

interface ImageFrame {
  src: string
  aspectRatio: number
}

interface ImageLayers {
  current: ImageFrame | null
  incoming: ImageFrame | null
  queued: ImageFrame | null
}

const TRANSITION_MS = 560

/** 每次只混合两张已解码的图片；连续到达的预览等待当前淡入结束，避免中途撤掉可见图层。 */
export function ProgressiveImageMedia({
  src,
  done,
  active,
  caption,
}: {
  src: string | null
  done: boolean
  active: boolean
  caption?: string
}) {
  const [layers, setLayers] = useState<ImageLayers>({ current: null, incoming: null, queued: null })
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!src) return
    const controller = new AbortController()
    setLayers((previous) => ({ ...previous, queued: null }))
    setFailedSrc(null)
    void loadProgressiveImage(src, controller.signal).then(
      (frame) => {
        if (controller.signal.aborted) return
        setLayers((previous) => {
          if (previous.current?.src === src || previous.incoming?.src === src) return previous
          return previous.incoming
            ? { ...previous, queued: frame }
            : { ...previous, incoming: frame }
        })
      },
      () => {
        if (!controller.signal.aborted) setFailedSrc(src)
      },
    )
    return () => controller.abort()
  }, [src, reload])

  useEffect(() => {
    if (!layers.incoming) return
    const incomingSrc = layers.incoming.src
    const finish = () =>
      setLayers((previous) =>
        previous.incoming?.src === incomingSrc
          ? { current: previous.incoming, incoming: previous.queued, queued: null }
          : previous,
      )
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motionPreference.matches) {
      finish()
      return
    }
    const onMotionChange = () => {
      if (motionPreference.matches) finish()
    }
    // 后台标签页可能不派发 animationend；计时仅清理已显示的旧层，不模拟生成进度。
    const timeout = window.setTimeout(finish, TRANSITION_MS + 60)
    motionPreference.addEventListener('change', onMotionChange)
    return () => {
      window.clearTimeout(timeout)
      motionPreference.removeEventListener('change', onMotionChange)
    }
  }, [layers.incoming])

  const visibleFrames = [layers.current, layers.incoming].filter((frame) => frame !== null)
  const aspectRatio = layers.incoming?.aspectRatio ?? layers.current?.aspectRatio
  const showPlaceholder = !layers.current
  const alt = done ? '模型生成的图片' : '生成中的图片'

  return (
    <div
      className="hc-image-stage-body relative mt-2 aspect-square"
      style={
        { aspectRatio, '--hc-image-transition-duration': `${TRANSITION_MS}ms` } as CSSProperties
      }
    >
      {showPlaceholder && (
        <div
          className={clsx(
            'hc-image-stage-placeholder absolute inset-0',
            layers.incoming && 'hc-progressive-image-outgoing',
          )}
        >
          <ImageGenerationDots active={active} />
        </div>
      )}
      {src && (
        <div className="hc-image-stage-media absolute inset-0 block">
          <ImagePreviewTrigger
            src={src}
            alt={alt}
            caption={caption}
            title={caption}
            className="h-full w-full overflow-hidden rounded-[inherit]"
          >
            {visibleFrames.map((frame) => (
              <img
                key={frame.src}
                src={frame.src}
                alt={frame === layers.incoming || !layers.incoming ? alt : ''}
                aria-hidden={frame === layers.current && !!layers.incoming ? true : undefined}
                className={clsx(
                  'hc-progressive-image absolute inset-0 h-full w-full object-cover',
                  frame === layers.incoming && 'hc-progressive-image-incoming',
                )}
              />
            ))}
            {!!visibleFrames.length && (
              <span className="absolute right-3 bottom-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/25 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 className="h-3.5 w-3.5" />
              </span>
            )}
          </ImagePreviewTrigger>
        </div>
      )}
      {!done && !!visibleFrames.length && (
        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/30 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-md">
          实时预览
        </span>
      )}
      {failedSrc === src && failedSrc && (
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-800/80 px-3 py-1.5 text-xs text-white backdrop-blur-sm hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          重新加载图片
        </button>
      )}
    </div>
  )
}
