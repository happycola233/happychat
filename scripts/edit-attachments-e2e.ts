import { mkdirSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { chromium, type Page } from '@playwright/test'
import type { ConversationDetail } from '@shared/types/api'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'admin'
const PASS = process.env.SMOKE_PASS ?? 'admin123'

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
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x += 1) {
    row[1 + x * 3] = rgb[0]
    row[1 + x * 3 + 1] = rgb[1]
    row[1 + x * 3 + 2] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function conversationIdFromUrl(url: string): string {
  const match = url.match(/\/c\/([^/?#]+)/)
  if (!match?.[1]) throw new Error(`无法从 URL 读取会话 id: ${url}`)
  return match[1]
}

async function waitGenDone(page: Page) {
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  await page.waitForTimeout(400)
}

function buildPath(detail: ConversationDetail) {
  const byId = new Map(detail.messages.map((message) => [message.id, message]))
  const path: ConversationDetail['messages'] = []
  const guard = new Set<string>()
  let current = detail.conversation.activeLeafId ? byId.get(detail.conversation.activeLeafId) : null
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : null
  }
  return path.reverse()
}

async function fetchDetail(page: Page, conversationId: string): Promise<ConversationDetail> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/conversations/${id}`, { credentials: 'include' })
    if (!response.ok) throw new Error(`detail failed: ${response.status}`)
    return response.json()
  }, conversationId)
}

async function selectCapableModel(page: Page) {
  const models = await page.evaluate(async () => {
    const response = await fetch('/api/models', { credentials: 'include' })
    if (!response.ok) throw new Error(`models failed: ${response.status}`)
    return (await response.json()) as {
      models: {
        id: string
        displayName: string
        kind: string
        capabilities: { vision: boolean; file_input: boolean }
      }[]
    }
  })
  const model = models.models.find(
    (item) => item.kind !== 'image' && item.capabilities.vision && item.capabilities.file_input,
  )
  if (!model) throw new Error('需要至少一个同时支持图片和文件输入的文本模型')

  await page.evaluate((modelId) => {
    localStorage.setItem(
      'happychat-prefs',
      JSON.stringify({
        state: {
          pinnedModelId: modelId,
          pinnedEffort: null,
          imageSize: 'auto',
          imageQuality: 'auto',
        },
        version: 0,
      }),
    )
  }, model.id)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  await page.getByText(model.displayName, { exact: true }).waitFor({ timeout: 10_000 })
  return model
}

function latestUserMessage(detail: ConversationDetail) {
  const user = buildPath(detail)
    .filter((message) => message.role === 'user')
    .at(-1)
  if (!user) throw new Error('当前路径没有用户消息')
  return user
}

async function main() {
  mkdirSync('.tmp', { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newContext().then((context) => context.newPage())
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  const model = await selectCapableModel(page)
  console.log('✓ 使用模型:', model.displayName)

  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'edit-original.png',
    mimeType: 'image/png',
    buffer: makePng(64, 64, [30, 120, 220]),
  })
  await page
    .locator('[data-testid="pending-attachment"][data-attachment-kind="image"]')
    .waitFor({ timeout: 10_000 })
  await page.locator('input[type="file"]:not([accept])').first().setInputFiles({
    name: 'old-edit.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('old retained file'),
  })
  await page
    .locator('[data-testid="pending-attachment"][data-attachment-kind="file"]')
    .waitFor({ timeout: 10_000 })

  const composer = page.getByPlaceholder('发送消息…')
  await composer.fill('请简短回复：已看到附件')
  await composer.press('Enter')
  await waitGenDone(page)
  const conversationId = conversationIdFromUrl(page.url())
  console.log('✓ 首轮带图片和文件发送完成:', conversationId)

  await page.getByLabel('编辑').first().click({ force: true })
  await page.getByTestId('edit-textarea').waitFor({ timeout: 5000 })
  const retainedCount = await page
    .locator('[data-testid="edit-attachment-chip"][data-retained="true"]')
    .count()
  if (retainedCount !== 2) throw new Error(`编辑框应保留 2 个附件，实际 ${retainedCount}`)
  console.log('✓ 编辑框展示已保留附件')

  await page
    .locator(
      '[data-testid="edit-attachment-chip"][data-attachment-kind="file"][data-retained="true"]',
    )
    .first()
    .getByLabel('移除附件')
    .click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByTestId('edit-upload-file').click()
  await (await fileChooser).setFiles({
    name: 'new-edit.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('new edit file'),
  })
  await page
    .locator('[data-testid="edit-attachment-chip"][data-attachment-kind="file"][data-retained="false"]')
    .waitFor({ timeout: 10_000 })
  await page.getByTestId('edit-textarea').fill('编辑后请简短回复：附件已更新')
  await page.getByTestId('edit-submit').click()
  await waitGenDone(page)
  console.log('✓ 编辑重发完成')

  const editedDetail = await fetchDetail(page, conversationId)
  const editedUser = latestUserMessage(editedDetail)
  const editedImages = editedUser.content.filter((part) => part.type === 'input_image')
  const editedFiles = editedUser.content
    .filter((part) => part.type === 'input_file')
    .map((part) => part.filename)
  if (editedImages.length !== 1) throw new Error('编辑分支应保留原图片')
  if (!editedFiles.includes('new-edit.txt')) throw new Error('编辑分支缺少新增文件')
  if (editedFiles.includes('old-edit.txt')) throw new Error('编辑分支不应包含已删除的旧文件')
  console.log('✓ 新分支附件集合正确')

  await page.getByLabel('上一个分支').first().click()
  await page.waitForTimeout(800)
  const oldDetail = await fetchDetail(page, conversationId)
  const oldUser = latestUserMessage(oldDetail)
  const oldFiles = oldUser.content
    .filter((part) => part.type === 'input_file')
    .map((part) => part.filename)
  if (!oldFiles.includes('old-edit.txt')) throw new Error('旧分支应仍包含旧文件')
  await page.screenshot({ path: '.tmp/edit-attachments-e2e.png', fullPage: true })
  console.log('✓ 旧分支附件仍保留')

  if (errors.length) console.log('⚠ pageerror:', errors.slice(0, 3))
  await browser.close()
  if (errors.length) process.exit(2)
  console.log('EDIT ATTACHMENTS PASS')
}

main().catch((error) => {
  console.error('EDIT ATTACHMENTS FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
