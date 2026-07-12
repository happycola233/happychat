import { and, asc, eq } from 'drizzle-orm'
import type { FolderDTO } from '@shared/types/api'
import type { CreateFolderInput, UpdateFolderInput } from '@shared/schemas/folder'
import { db } from '../db/client'
import { conversations, folders } from '../db/schema'
import { must } from '../lib/assert'

export type FolderRow = typeof folders.$inferSelect

export function toFolderDTO(f: FolderRow): FolderDTO {
  return {
    id: f.id,
    name: f.name,
    color: f.color,
    emoji: f.emoji,
    pinnedAt: f.pinnedAt?.getTime() ?? null,
    createdAt: f.createdAt.getTime(),
    updatedAt: f.updatedAt.getTime(),
  }
}

/** 列出某用户全部文件夹（创建序，置顶分组由前端按 pinnedAt 处理）。 */
export async function listFolders(userId: string): Promise<FolderDTO[]> {
  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.createdAt))
  return rows.map(toFolderDTO)
}

export async function getOwnedFolder(userId: string, id: string): Promise<FolderRow | null> {
  const [f] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId)))
    .limit(1)
  return f ?? null
}

export async function createFolder(userId: string, input: CreateFolderInput): Promise<FolderDTO> {
  const [row] = await db
    .insert(folders)
    .values({
      userId,
      name: input.name,
      color: input.color ?? null,
      emoji: input.emoji ?? null,
    })
    .returning()
  return toFolderDTO(must(row))
}

export async function updateFolder(
  userId: string,
  id: string,
  input: UpdateFolderInput,
): Promise<FolderDTO | null> {
  const folder = await getOwnedFolder(userId, id)
  if (!folder) return null

  const patch: Partial<typeof folders.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.color !== undefined) patch.color = input.color
  if (input.emoji !== undefined) patch.emoji = input.emoji
  if (input.pinned !== undefined) patch.pinnedAt = input.pinned ? new Date() : null

  const [updated] = await db.update(folders).set(patch).where(eq(folders.id, folder.id)).returning()
  return updated ? toFolderDTO(updated) : null
}

/**
 * 删除文件夹：其中的会话移回未分组（不删除会话本身）。
 * folder_id 外键已声明 ON DELETE SET NULL，这里仍显式移出，让行为不依赖 DDL 细节；
 * 逐行保留 updatedAt 原值，避免移出动作打乱「最近」排序。
 */
export async function deleteFolder(userId: string, id: string): Promise<boolean> {
  const folder = await getOwnedFolder(userId, id)
  if (!folder) return false
  const members = await db
    .select({ id: conversations.id, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.folderId, folder.id))
  db.transaction((tx) => {
    for (const m of members) {
      tx.update(conversations)
        .set({ folderId: null, updatedAt: m.updatedAt })
        .where(eq(conversations.id, m.id))
        .run()
    }
    tx.delete(folders).where(eq(folders.id, folder.id)).run()
  })
  return true
}
