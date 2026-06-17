import { crc32, deflateSync } from 'node:zlib'
import { chromium, type Page } from '@playwright/test'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crcBuf])
}

function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = rgb[0]
    row[1 + x * 3 + 1] = rgb[1]
    row[1 + x * 3 + 2] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const idat = deflateSync(raw)
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

async function selectModel(page: Page, name: string) {
  await page.locator('header button').first().click()
  await page.getByText(name, { exact: true }).click()
  await page.waitForTimeout(300)
}

async function main() {
  const png = makePng(128, 128, [220, 30, 30]) // 红色方块
  const browser = await chromium.launch()
  const page = await browser.newContext().then((c) => c.newPage())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill('admin')
  await page.getByPlaceholder('请输入密码').fill('admin123')
  await page.getByRole('button', { name: '登录' }).click()
  const composer = page.getByPlaceholder('发送消息…')
  await composer.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1200)

  await selectModel(page, 'gpt-5.4-mini')
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: png,
  })
  // 等待上传完成（缩略图出现）
  await page.waitForTimeout(2000)
  await composer.fill('这张图片主要是什么颜色？只回答颜色。')
  await composer.press('Enter')
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  await page.waitForTimeout(500)

  const userImg = await page.locator('img[alt="图片"]').count()
  const answer = await page.getByTestId('assistant-message').last().innerText()
  console.log('用户消息含图片缩略图:', userImg > 0)
  console.log('助手回答:', answer.slice(0, 40).replace(/\n/g, ' '))
  const mentionsRed = /红|red/i.test(answer)
  console.log('回答提到红色:', mentionsRed)

  await page.screenshot({ path: 'data/ui-image-input.png', fullPage: true })

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  const pass = userImg > 0 && mentionsRed && errors.length === 0
  console.log(pass ? 'IMAGE-INPUT PASS' : 'IMAGE-INPUT CHECK')
  await browser.close()
  if (!pass) process.exit(2)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
