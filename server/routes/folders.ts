import { Hono } from 'hono'
import { createFolderSchema, updateFolderSchema } from '@shared/schemas/folder'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import { createFolder, deleteFolder, listFolders, updateFolder } from '../services/folders'
import type { AppEnv } from '../http/types'

export const folderRoutes = new Hono<AppEnv>()

folderRoutes.use('*', requireUser)

folderRoutes.get('/', async (c) => {
  return c.json({ folders: await listFolders(c.get('user').id) })
})

folderRoutes.post('/', jsonValidator(createFolderSchema), async (c) => {
  const folder = await createFolder(c.get('user').id, c.req.valid('json'))
  return c.json({ folder })
})

/** 更新名称/颜色/图标/置顶；color、emoji 传 null 表示恢复默认。 */
folderRoutes.patch('/:id', jsonValidator(updateFolderSchema), async (c) => {
  const folder = await updateFolder(c.get('user').id, c.req.param('id'), c.req.valid('json'))
  if (!folder) return c.json({ error: { message: '文件夹不存在', code: 'not_found' } }, 404)
  return c.json({ folder })
})

/** 删除文件夹：其中的会话移回未分组，不删除会话。 */
folderRoutes.delete('/:id', async (c) => {
  const ok = await deleteFolder(c.get('user').id, c.req.param('id'))
  if (!ok) return c.json({ error: { message: '文件夹不存在', code: 'not_found' } }, 404)
  return c.json({ ok: true })
})
