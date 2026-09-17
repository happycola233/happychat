import { describe, expect, it } from 'vitest'
import { announcementBodyImageIds, announcementBodyImages } from './announcementImages'
import {
  announcementImageMarkup,
  announcementImageUrl,
  parseAnnouncementImageCrop,
} from '../schemas/announcement-image'

const id = '01994a8e-3d09-7777-8aaa-0123456789ab'
const src = announcementImageUrl(id)

describe('announcement image source and layout', () => {
  it('round trips editable crop geometry and escaped descriptions with exact source ranges', () => {
    const image = {
      src,
      alt: '小于 < 大于 > & "引用"',
      width: 480,
      height: 270,
      crop: { x: 10, y: 20, width: 80, height: 45 },
    }
    const markup = announcementImageMarkup(image)
    const body = `开头\n\n${markup}\n\n结尾`
    const [parsed] = announcementBodyImages(body)
    expect(parsed).toMatchObject(image)
    expect(body.slice(parsed!.start, parsed!.end)).toBe(markup)
    expect(announcementBodyImageIds(body)).toEqual([id])
  })

  it('reads markdown, reference images and HTML but ignores code and comments', () => {
    const body = `![外链](https://example.com/image.png)\n\n![引用][pic]\n\n[pic]: ${src}\n\n\`![代码](${src})\`\n\n<!-- <img src="${src}"> -->\n\n\`\`\`html\n<img src="${src}">\n\`\`\``
    expect(announcementBodyImages(body)).toHaveLength(2)
    expect(announcementBodyImageIds(body)).toEqual([id])
  })

  it('rejects crop overflow, zero area and non-numeric CSS injection', () => {
    for (const value of [
      '0,0,0,100',
      '90,0,20,100',
      '-1,0,100,100',
      'NaN,0,100,100',
      '0,0,100,100;position:fixed',
    ]) {
      expect(parseAnnouncementImageCrop(value)).toBeUndefined()
    }
  })
})
