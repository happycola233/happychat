import type { ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import {
  announcementImageDimension,
  parseAnnouncementImageCrop,
  type AnnouncementImageCrop,
} from '@shared/schemas/announcement-image'

/** 展示参数只作用于公告；图片内容仍是原图，反复裁剪不会损失画质或动图帧。 */
export function AnnouncementImage({
  src,
  alt,
  width,
  height,
  node,
}: ComponentProps<'img'> & ExtraProps) {
  const crop = parseAnnouncementImageCrop(node?.properties.dataCrop)
  const displayWidth = announcementImageDimension(width)
  const displayHeight = announcementImageDimension(height)
  return (
    <AnnouncementImageFrame
      src={src}
      alt={alt}
      width={displayWidth}
      height={displayHeight}
      crop={crop}
    />
  )
}

export function AnnouncementImageFrame({
  src,
  alt,
  width,
  height,
  crop,
}: {
  src?: string
  alt?: string
  width?: number
  height?: number
  crop?: AnnouncementImageCrop
}) {
  const cropped = crop && width && height
  return (
    <span
      className="hc-announcement-image"
      style={{ width, aspectRatio: cropped ? `${width} / ${height}` : undefined }}
    >
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        style={
          cropped
            ? {
                position: 'absolute',
                maxWidth: 'none',
                width: `${10000 / crop.width}%`,
                height: `${10000 / crop.height}%`,
                left: `${(-100 * crop.x) / crop.width}%`,
                top: `${(-100 * crop.y) / crop.height}%`,
              }
            : undefined
        }
      />
    </span>
  )
}
