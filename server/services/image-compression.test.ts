import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { compressChatImage } from './image-compression'

async function samplePng() {
  return sharp({
    create: {
      width: 320,
      height: 240,
      channels: 4,
      background: { r: 40, g: 120, b: 210, alpha: 0.5 },
    },
  })
    .png({ compressionLevel: 0 })
    .toBuffer()
}

describe('chat image compression', () => {
  it('减少图片字节数，保留像素尺寸和透明通道，同步文件扩展名与 MIME', async () => {
    const buffer = await samplePng()
    const result = await compressChatImage({ buffer, filename: '图片.v2.PNG', mime: 'image/png' })
    expect(result.filename).toBe('图片.v2.webp')
    expect(result.mime).toBe('image/webp')
    expect(result.buffer.length).toBeLessThan(buffer.length / 2)
    expect(await sharp(result.buffer).metadata()).toMatchObject({
      format: 'webp',
      width: 320,
      height: 240,
      hasAlpha: true,
    })
    const alpha = (input: Buffer) => sharp(input).extractChannel('alpha').raw().toBuffer()
    expect(await alpha(result.buffer)).toEqual(await alpha(buffer))
  })

  it('按 EXIF 方向保留手机竖拍的显示尺寸，不缩放，移除多余元数据', async () => {
    const buffer = await sharp(await samplePng())
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { ImageDescription: 'Synthetic orientation fixture '.repeat(500) } })
      .jpeg({ quality: 100 })
      .toBuffer()
    const result = await compressChatImage({
      buffer,
      filename: 'portrait.jpeg',
      mime: 'image/jpeg',
    })
    expect(result.mime).toBe('image/webp')
    const metadata = await sharp(result.buffer).metadata()
    expect(metadata).toMatchObject({ width: 240, height: 320 })
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
  })

  it('无扩展名上传也返回与压缩内容一致的文件名', async () => {
    const result = await compressChatImage({
      buffer: await samplePng(),
      filename: 'clipboard',
      mime: 'image/png',
    })
    expect(result.filename).toBe('clipboard.webp')
  })

  it('已优化的小图片没有足够收益时保留原始字节', async () => {
    const buffer = await sharp(await samplePng())
      .webp({ lossless: true })
      .toBuffer()
    const upload = { buffer, filename: 'tiny.webp', mime: 'image/webp' }
    expect(await compressChatImage(upload)).toBe(upload)
  })

  it('保留动图的全部原始字节，不把 GIF/WebP 或伪装扩展名的动图转为静态图', async () => {
    const pixels = Buffer.alloc(80 * 120 * 4, 255)
    pixels.fill(0, 80 * 60 * 4)
    for (const format of ['webp', 'gif'] as const) {
      const buffer = await sharp(pixels, {
        raw: { width: 80, height: 120, channels: 4, pageHeight: 60 },
      })
        .toFormat(format, { delay: [100, 100], loop: 0 })
        .toBuffer()
      expect((await sharp(buffer).metadata()).pages).toBe(2)
      for (const mime of [`image/${format}`, 'image/png']) {
        const upload = { buffer, filename: 'animation.png', mime }
        expect(await compressChatImage(upload)).toBe(upload)
      }
    }
  })

  it('PNG 出现 APNG 动画控制块时原样保留，不依赖解码器未提供的帧数', async () => {
    const png = await samplePng()
    const animationControl = Buffer.alloc(20)
    animationControl.writeUInt32BE(8, 0)
    animationControl.write('acTL', 4)
    animationControl.writeUInt32BE(2, 8)
    animationControl.writeUInt32BE(0xf38d9370, 16) // acTL + 两帧/无限循环的 CRC32。
    const buffer = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)])
    // 确认 PNG 本身可解码，否则「解码失败保留原件」也会让此回归用例误通过。
    await expect(sharp(buffer).png().toBuffer()).resolves.toBeInstanceOf(Buffer)
    const upload = { buffer, filename: 'animation.png', mime: 'image/png' }
    expect(await compressChatImage(upload)).toBe(upload)
  })

  it('不缩小超出 WebP 编码尺寸的长截图，也不降位深', async () => {
    const longScreenshot = await sharp({
      create: { width: 8, height: 16_384, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer()
    const highDepth = await sharp(await samplePng())
      .toColourspace('rgb16')
      .png()
      .toBuffer()
    expect((await sharp(highDepth).metadata()).depth).toBe('ushort')
    for (const buffer of [longScreenshot, highDepth]) {
      const upload = { buffer, filename: 'original.png', mime: 'image/png' }
      expect(await compressChatImage(upload)).toBe(upload)
    }
  })

  it('损坏图片和非图片原样保留，失败后不占用后续压缩名额', async () => {
    const uploads = Array.from({ length: 4 }, () => ({
      buffer: Buffer.from('broken'),
      filename: 'broken.jpg',
      mime: 'image/jpeg',
    }))
    const valid = { buffer: await samplePng(), filename: 'valid.png', mime: 'image/png' }
    const results = await Promise.all([...uploads, valid].map(compressChatImage))
    uploads.forEach((upload, index) => expect(results[index]).toBe(upload))
    expect(results.at(-1)?.mime).toBe('image/webp')
    const document = {
      buffer: Buffer.from('plain text'),
      filename: 'notes.txt',
      mime: 'text/plain',
    }
    expect(await compressChatImage(document)).toBe(document)
  })
})
