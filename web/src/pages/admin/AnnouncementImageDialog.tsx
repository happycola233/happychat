import { useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Crop, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { clsx } from 'clsx'
import type { AnnouncementImageLayout } from '@shared/schemas/announcement-image'
import { AnnouncementImageFrame } from '../../announcements/AnnouncementImage'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'

const RATIOS = [
  { label: '原图', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

export function AnnouncementImageDialog({
  image,
  editing,
  busy,
  remaining,
  onApply,
  onClose,
}: {
  image: AnnouncementImageLayout
  editing: boolean
  busy: boolean
  remaining: number
  onApply: (image: AnnouncementImageLayout) => void
  onClose: () => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [originalRatio, setOriginalRatio] = useState(1)
  const [aspect, setAspect] = useState<number | null>(
    image.crop && image.height ? image.width / image.height : null,
  )
  const [initialCrop, setInitialCrop] = useState(image.crop)
  const [area, setArea] = useState<Area | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [width, setWidth] = useState(String(image.width))
  const [alt, setAlt] = useState(image.alt)
  const [resetKey, setResetKey] = useState(0)
  const displayWidth = Number(width)
  const validWidth = Number.isInteger(displayWidth) && displayWidth >= 80 && displayWidth <= 1600
  const displayHeight = Math.max(1, Math.round(displayWidth / (aspect ?? originalRatio)))
  const layout: AnnouncementImageLayout = {
    src: image.src,
    alt,
    width: displayWidth,
    height: displayHeight,
    crop: area ?? undefined,
  }
  const chooseRatio = (value: number | null) => {
    setAspect(value)
    setInitialCrop(undefined)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setResetKey((key) => key + 1)
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      animate={false}
      size="workspace"
      title={
        <>
          <Crop className="mr-2 h-4 w-4" />
          {editing ? '编辑公告图片' : '插入公告图片'}
        </>
      }
      footer={
        <>
          <span
            role="status"
            className="mr-auto self-center text-xs text-neutral-500 dark:text-neutral-400"
          >
            {busy
              ? '正在上传图片…'
              : remaining > 1
                ? `另有 ${remaining - 1} 张待编辑`
                : '原图保留，可随时重新调整'}
          </span>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            loading={busy}
            disabled={!loaded || loadFailed || !area || !validWidth}
            onClick={() => onApply(layout)}
          >
            {editing ? '应用修改' : '插入图片'}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <div className="relative h-[min(34vh,18rem)] min-h-48 overflow-hidden rounded-xl bg-neutral-100 sm:h-[min(42vh,23rem)] dark:bg-neutral-950">
            <Cropper
              key={resetKey}
              image={image.src}
              crop={crop}
              zoom={zoom}
              aspect={aspect ?? originalRatio}
              minZoom={1}
              maxZoom={5}
              zoomWithScroll={false}
              initialCroppedAreaPercentages={initialCrop}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={setArea}
              onMediaLoaded={(media) => {
                setOriginalRatio(media.naturalWidth / media.naturalHeight)
                setLoaded(true)
              }}
              mediaProps={{ onError: () => setLoadFailed(true), alt: '拖动图片调整取景' }}
              cropperProps={{ 'aria-label': '图片裁剪区域' }}
            />
            {loadFailed && (
              <div
                role="alert"
                className="absolute inset-0 flex items-center justify-center bg-neutral-100 p-6 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
              >
                图片加载失败，请检查链接或重新上传。
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ZoomOut className="h-4 w-4 shrink-0 text-neutral-400" />
            <input
              type="range"
              aria-label="图片缩放"
              min={1}
              max={5}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-sky-500 dark:bg-neutral-700"
            />
            <ZoomIn className="h-4 w-4 shrink-0 text-neutral-400" />
            <output className="w-10 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {zoom.toFixed(1)}×
            </output>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span>拖动或用方向键移动，双指可缩放</span>
            <Button variant="ghost" size="sm" onClick={() => chooseRatio(null)}>
              <RotateCcw className="h-3.5 w-3.5" />
              重置裁剪
            </Button>
          </div>
          <div className="mt-4 hidden rounded-xl bg-neutral-50 px-4 py-3 md:block dark:bg-neutral-950/50">
            <div className="mb-2 flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span>展示预览</span>
              <span className="tabular-nums">
                {validWidth ? `${displayWidth} × ${displayHeight} px` : '—'}
              </span>
            </div>
            {area && validWidth && (
              <div
                className="hc-announcement-body hc-md mx-auto"
                style={{
                  width: `${Math.min(100, (displayWidth / 736) * 100)}%`,
                  maxWidth: `${160 * (aspect ?? originalRatio)}px`,
                }}
              >
                <AnnouncementImageFrame {...layout} />
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-5">
          <div>
            <span className="mb-2 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              裁剪比例
            </span>
            <div role="group" aria-label="裁剪比例" className="grid grid-cols-3 gap-1.5">
              {RATIOS.map((ratio) => (
                <button
                  key={ratio.label}
                  type="button"
                  aria-pressed={
                    ratio.value === null
                      ? aspect === null
                      : aspect !== null && Math.abs(aspect - ratio.value) < 0.005
                  }
                  onClick={() => chooseRatio(ratio.value)}
                  className={clsx(
                    'min-h-9 rounded-lg border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50',
                    (
                      ratio.value === null
                        ? aspect === null
                        : aspect !== null && Math.abs(aspect - ratio.value) < 0.005
                    )
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
                  )}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <TextField
              label="展示宽度（px）"
              type="number"
              min={80}
              max={1600}
              step={1}
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              error={!validWidth ? '请输入 80–1600 的整数' : undefined}
              hint="高度随比例调整，小屏幕自动缩小。"
            />
            <div className="mt-2 flex gap-1.5">
              {[
                { label: '小图', value: 320 },
                { label: '中图', value: 480 },
                { label: '通栏', value: 736 },
              ].map((preset) => (
                <Button
                  key={preset.value}
                  variant="secondary"
                  size="sm"
                  aria-pressed={displayWidth === preset.value}
                  onClick={() => setWidth(String(preset.value))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <TextField
            label="图片描述"
            value={alt}
            maxLength={500}
            onChange={(event) => setAlt(event.target.value)}
            placeholder="简短描述图片内容"
            hint="帮助使用屏幕阅读器的读者理解图片。"
          />
        </div>
      </fieldset>
    </Modal>
  )
}
