import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { toast } from '../store/toast'

/** 头像导出边长：足够清晰且体积可控。 */
const OUTPUT_SIZE_PX = 512

/** 把裁切区域绘制到方形画布并导出为 WebP File（动图会转为静态首帧）。 */
async function cropToFile(imageSrc: string, area: Area): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE_PX
  canvas.height = OUTPUT_SIZE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持画布导出')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE_PX, OUTPUT_SIZE_PX)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new Error('导出头像失败')
  return new File([blob], 'avatar.webp', { type: 'image/webp' })
}

/**
 * 头像裁切对话框：圆形取景框内拖动平移、滚轮/滑杆缩放（react-easy-crop，含触屏双指），
 * 确认后把选区导出为 512×512 WebP 交给上层上传。
 */
export function AvatarCropDialog({
  imageSrc,
  uploading,
  onCancel,
  onConfirm,
}: {
  /** 待裁切图片的 object URL（由上层创建与回收）。 */
  imageSrc: string
  /** 上层上传进行中：确认按钮转 loading，避免重复提交。 */
  uploading: boolean
  onCancel: () => void
  onConfirm: (file: File) => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [areaPixels, setAreaPixels] = useState<Area | null>(null)
  const [exporting, setExporting] = useState(false)

  const onCropComplete = useCallback((_area: Area, pixels: Area) => setAreaPixels(pixels), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirm = async () => {
    if (!areaPixels) return
    setExporting(true)
    try {
      onConfirm(await cropToFile(imageSrc, areaPixels))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '裁切失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="hc-pop-in relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
          <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
            裁切头像
          </h3>
        </div>

        {/* 取景区：深底衬托圆形选框，拖动平移、滚轮/双指缩放。 */}
        <div className="relative h-72 bg-neutral-950">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={1}
            maxZoom={4}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex items-center gap-2.5 px-5 py-3">
          <ZoomOut className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="缩放"
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-sky-500 dark:bg-neutral-700"
          />
          <ZoomIn className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-3.5 dark:border-neutral-800">
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={onCancel}>
            取消
          </Button>
          <Button
            className="!px-3 !py-1.5 text-xs"
            loading={exporting || uploading}
            disabled={!areaPixels}
            onClick={() => void confirm()}
          >
            确认并上传
          </Button>
        </div>
      </div>
    </div>
  )
}
