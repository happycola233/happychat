import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ConversationDTO, FolderDTO } from '../shared/types/api'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173'
const USER = process.env.SMOKE_USER ?? 'test'
const PASS = process.env.SMOKE_PASS ?? 'testtest'

const FOLDER_NAME = `E2E 文件夹 ${Date.now() % 100000}`

function conversationIdFromUrl(url: string): string {
  const match = url.match(/\/c\/([^/?#]+)/)
  if (!match?.[1]) throw new Error(`无法从 URL 读取会话 id: ${url}`)
  return match[1]
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return (await page.evaluate(async (p) => {
    const response = await fetch(`/api${p}`, { credentials: 'include' })
    if (!response.ok) throw new Error(`${p} -> ${response.status}`)
    return response.json()
  }, path)) as T
}

/** 发送一条短消息创建新会话，等待生成结束后返回会话 id。 */
async function createConversation(page: Page, marker: string): Promise<string> {
  await page.getByTestId('sidebar-new-chat').click()
  const composer = page.getByPlaceholder('发送消息…')
  await composer.waitFor({ timeout: 10_000 })
  await composer.fill(`请只回复两个字：收到。（${marker}）`)
  const runStarted = page.waitForResponse(
    (response) => response.url().includes('/api/runs') && response.request().method() === 'POST',
    { timeout: 30_000 },
  )
  await composer.press('Enter')
  await runStarted
  await page.waitForURL(/\/c\//, { timeout: 30_000 })
  const id = conversationIdFromUrl(page.url())
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-btn"]'), null, {
    timeout: 90_000,
  })
  return id
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext().then((context) => context.newPage())
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByPlaceholder('请输入用户名').fill(USER)
  await page.getByPlaceholder('请输入密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByPlaceholder('发送消息…').waitFor({ timeout: 10_000 })
  console.log('✓ 登录成功')

  // ---------- 造两个新会话（后续移动/批量删除只动它们，不碰历史数据） ----------
  const convA = await createConversation(page, 'folders-a')
  const convB = await createConversation(page, 'folders-b')
  console.log('✓ 创建两个测试会话:', convA, convB)

  const aside = page.locator('aside')

  // ---------- 新建文件夹（标题右侧按钮 → 弹窗：命名 + 选色 + 选 emoji） ----------
  await page.getByTestId('sidebar-new-folder').click()
  await page.getByTestId('folder-editor').waitFor({ timeout: 8_000 })
  await page.getByTestId('folder-name-input').fill(FOLDER_NAME)
  await page.getByLabel('颜色 #0ea5e9').click()

  // Emoji 数据由服务端同源提供（/api/emoji-data）。注意 frimousse 列表首个
  // [frimousse-emoji] 是隐藏的尺寸测量行，必须限定在可见行（带 aria-rowindex）内。
  await page.getByLabel('选择图标').click()
  const visibleEmoji = () => page.locator('[aria-rowindex] [frimousse-emoji]').first()
  await visibleEmoji().waitFor({ timeout: 15_000 })
  await page.locator('[frimousse-search]').fill('猫')
  await visibleEmoji().waitFor({ timeout: 8_000 })
  await visibleEmoji().click()
  console.log('✓ Emoji 选择器可用（中文搜索命中）')
  const emojiAvailable = true

  await page.getByTestId('folder-editor-submit').click()
  await page.getByTestId('folder-editor').waitFor({ state: 'detached', timeout: 8_000 })

  const { folders: created } = await apiGet<{ folders: FolderDTO[] }>(page, '/folders')
  const folder = created.find((f) => f.name === FOLDER_NAME)
  if (!folder) throw new Error('创建的文件夹未出现在 /api/folders')
  if (folder.color !== '#0ea5e9') throw new Error(`文件夹颜色未保存: ${folder.color}`)
  if (emojiAvailable && !folder.emoji) throw new Error('文件夹 emoji 未保存')
  const folderRow = aside.locator(`[data-folder-id="${folder.id}"]`)
  await folderRow.waitFor({ timeout: 8_000 })
  console.log('✓ 新建文件夹成功（颜色/图标已保存，侧栏可见）')

  // ---------- 行内菜单：把会话 A 移入文件夹 ----------
  const rowA = aside.locator(`[data-conversation-id="${convA}"]`).first()
  await rowA.hover()
  await rowA.getByLabel('更多操作').click()
  await rowA.getByRole('button', { name: '移动到文件夹' }).click()
  // 菜单渲染在会话行内部：作用域限定到该行，避免命中侧栏里的同名文件夹行。
  await rowA.getByRole('button', { name: FOLDER_NAME }).click()
  await page.waitForFunction(
    async (args) => {
      const response = await fetch('/api/conversations', { credentials: 'include' })
      const data = (await response.json()) as {
        conversations: { id: string; folderId: string | null }[]
      }
      return data.conversations.find((c) => c.id === args.convA)?.folderId === args.folderId
    },
    { convA, folderId: folder.id },
    { timeout: 10_000 },
  )
  console.log('✓ 行内菜单移动会话到文件夹成功')

  // 展开文件夹后能看到成员会话
  await folderRow.getByRole('button', { name: FOLDER_NAME }).first().click()
  await aside
    .locator(`li[data-folder-id="${folder.id}"] [data-conversation-id="${convA}"]`)
    .waitFor({
      timeout: 8_000,
    })
  console.log('✓ 文件夹展开显示成员会话')

  // ---------- 文件夹设置：改色 ----------
  await folderRow.hover()
  await folderRow.getByLabel('文件夹操作').click()
  await page.getByRole('button', { name: '文件夹设置' }).click()
  await page.getByTestId('folder-editor').waitFor({ timeout: 8_000 })
  await page.getByLabel('颜色 #ec4899').click()
  await page.getByTestId('folder-editor-submit').click()
  await page.getByTestId('folder-editor').waitFor({ state: 'detached', timeout: 8_000 })
  const afterEdit = await apiGet<{ folders: FolderDTO[] }>(page, '/folders')
  if (afterEdit.folders.find((f) => f.id === folder.id)?.color !== '#ec4899') {
    throw new Error('文件夹改色未生效')
  }
  console.log('✓ 文件夹设置（改色）生效')

  // ---------- 文件夹置顶 ----------
  await folderRow.hover()
  await folderRow.getByLabel('文件夹操作').click()
  await page.getByRole('button', { name: '置顶', exact: true }).click()
  await page.waitForFunction(
    async (folderId) => {
      const response = await fetch('/api/folders', { credentials: 'include' })
      const data = (await response.json()) as { folders: { id: string; pinnedAt: number | null }[] }
      return Boolean(data.folders.find((f) => f.id === folderId)?.pinnedAt)
    },
    folder.id,
    { timeout: 10_000 },
  )
  await folderRow.waitFor({ timeout: 8_000 })
  console.log('✓ 文件夹置顶成功（已置顶分区可见）')

  await page.screenshot({ path: 'data/folders-light.png', fullPage: true })

  // ---------- 批量管理：选中会话 B → 批量移动到文件夹 ----------
  await page.getByTestId('sidebar-batch-manage').click()
  await page.getByTestId('batch-toolbar').waitFor({ timeout: 8_000 })
  await aside.locator(`[data-conversation-id="${convB}"] button`).first().click()
  const countText = await page.getByTestId('batch-selected-count').textContent()
  if (!countText?.includes('已选 1 个聊天')) throw new Error(`批量选中计数异常: ${countText}`)
  await page.getByTestId('batch-move').click()
  await page.getByTestId('batch-toolbar').getByRole('button', { name: FOLDER_NAME }).click()
  await page.waitForFunction(
    async (args) => {
      const response = await fetch('/api/conversations', { credentials: 'include' })
      const data = (await response.json()) as {
        conversations: { id: string; folderId: string | null }[]
      }
      return data.conversations.find((c) => c.id === args.convB)?.folderId === args.folderId
    },
    { convB, folderId: folder.id },
    { timeout: 10_000 },
  )
  await page.getByTestId('batch-toolbar').waitFor({ state: 'detached', timeout: 8_000 })
  console.log('✓ 批量移动成功（完成后自动退出批量模式）')

  // ---------- 批量管理：选中 A+B → 批量删除（含确认弹窗） ----------
  await page.getByTestId('sidebar-batch-manage').click()
  await page.getByTestId('batch-toolbar').waitFor({ timeout: 8_000 })
  for (const conv of [convA, convB]) {
    await aside.locator(`[data-conversation-id="${conv}"] button`).first().click()
  }
  const twoText = await page.getByTestId('batch-selected-count').textContent()
  if (!twoText?.includes('已选 2 个聊天')) throw new Error(`批量选中计数异常: ${twoText}`)
  await page.getByTestId('batch-delete').click()
  await page.getByRole('alertdialog').waitFor({ timeout: 8_000 })
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
  await page.waitForFunction(
    async (ids) => {
      const response = await fetch('/api/conversations', { credentials: 'include' })
      const data = (await response.json()) as { conversations: { id: string }[] }
      return ids.every((id) => !data.conversations.some((c) => c.id === id))
    },
    [convA, convB],
    { timeout: 10_000 },
  )
  console.log('✓ 批量删除成功')

  // ---------- 深色模式检查 + 截图 ----------
  for (let i = 0; i < 3; i += 1) {
    if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) break
    await page.getByLabel('切换主题').click()
    await page.waitForTimeout(200)
  }
  await page.getByTestId('sidebar-new-folder').click()
  await page.getByTestId('folder-editor').waitFor({ timeout: 8_000 })
  await page.screenshot({ path: 'data/folders-dark-editor.png', fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByTestId('folder-editor').waitFor({ state: 'detached', timeout: 8_000 })
  console.log('✓ 深色模式弹窗截图完成')

  // ---------- 删除文件夹（会话应移回未分组；这里文件夹已空） ----------
  await folderRow.hover()
  await folderRow.getByLabel('文件夹操作').click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('alertdialog').waitFor({ timeout: 8_000 })
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
  await page.waitForFunction(
    async (folderId) => {
      const response = await fetch('/api/folders', { credentials: 'include' })
      const data = (await response.json()) as { folders: { id: string }[] }
      return !data.folders.some((f) => f.id === folderId)
    },
    folder.id,
    { timeout: 10_000 },
  )
  console.log('✓ 删除文件夹成功')

  const { conversations: finalConvs } = await apiGet<{ conversations: ConversationDTO[] }>(
    page,
    '/conversations',
  )
  if (finalConvs.some((c) => c.id === convA || c.id === convB)) {
    throw new Error('测试会话清理不彻底')
  }

  if (errors.length) console.log('⚠ 控制台错误:', errors.slice(0, 5))
  await browser.close()
  console.log('FOLDERS E2E PASS')
}

main().catch((error) => {
  console.error('FOLDERS E2E FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
