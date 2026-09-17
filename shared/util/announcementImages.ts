import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import type { Element, Root } from 'hast'
import {
  ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH,
  announcementImageDimension,
  announcementImageId,
  parseAnnouncementImageCrop,
  type AnnouncementImageLayout,
} from '../schemas/announcement-image'

export interface AnnouncementBodyImage extends AnnouncementImageLayout {
  start: number
  end: number
}

const imageParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)

/** 与正文相同的 Markdown/HTML 解析，避免把代码块、注释或链接文字误认为图片。 */
export function announcementBodyImages(body: string): AnnouncementBodyImage[] {
  const tree = imageParser.runSync(imageParser.parse(body)) as Root
  const images: AnnouncementBodyImage[] = []
  const visit = (node: Root | Element) => {
    if (node.type === 'element' && node.tagName === 'img') {
      const { src, alt, width, height, dataCrop } = node.properties
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (typeof src === 'string' && start !== undefined && end !== undefined) {
        images.push({
          src,
          alt: typeof alt === 'string' ? alt : '',
          width: announcementImageDimension(width) ?? ANNOUNCEMENT_IMAGE_DEFAULT_WIDTH,
          height: announcementImageDimension(height),
          crop: parseAnnouncementImageCrop(dataCrop),
          start,
          end,
        })
      }
    }
    for (const child of node.children) {
      if (child.type === 'element') visit(child)
    }
  }
  visit(tree)
  return images
}

export function announcementBodyImageIds(body: string): string[] {
  return [
    ...new Set(
      announcementBodyImages(body).flatMap((image) => {
        const id = announcementImageId(image.src)
        return id ? [id] : []
      }),
    ),
  ]
}
