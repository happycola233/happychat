import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { attachments } from "./db/schema.js";
import { env } from "./env.js";
import { forbidden, notFound } from "./errors.js";
import { attachmentView } from "./mappers.js";
import { newId } from "./utils/ids.js";
import { sha256 } from "./utils/crypto.js";
import type { AttachmentKind, AttachmentView } from "../shared/types.js";

export async function saveUpload(input: {
  userId: string;
  file: File;
  conversationId?: string | null;
}): Promise<AttachmentView> {
  const arrayBuffer = await input.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const hash = sha256(buffer);
  const kind: AttachmentKind = input.file.type.startsWith("image/") ? "image" : "file";
  const id = newId("att");
  const safeExt = extname(input.file.name).slice(0, 12);
  const dir = join(env.uploadDir, input.userId);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, `${id}${safeExt}`);
  writeFileSync(storagePath, buffer);
  await db.insert(attachments).values({
    id,
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    kind,
    originalName: input.file.name || "未命名文件",
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: buffer.length,
    storagePath,
    sha256: hash
  });
  const row = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  return attachmentView(row);
}

export async function saveGeneratedImage(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  runId: string;
  base64: string;
  mimeType?: string;
}): Promise<AttachmentView> {
  const mimeType = input.mimeType ?? "image/png";
  const ext = mimeType.includes("jpeg") ? ".jpg" : mimeType.includes("webp") ? ".webp" : ".png";
  const buffer = Buffer.from(input.base64, "base64");
  const id = newId("att");
  const dir = join(env.uploadDir, input.userId);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, `${id}${ext}`);
  writeFileSync(storagePath, buffer);
  await db.insert(attachments).values({
    id,
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    runId: input.runId,
    kind: "generated_image",
    originalName: `生成图片-${id}${ext}`,
    mimeType,
    sizeBytes: buffer.length,
    storagePath,
    sha256: sha256(buffer)
  });
  const row = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  return attachmentView(row);
}

export async function attachmentForUser(id: string, userId: string, isAdmin: boolean) {
  const row = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  if (!row) notFound("附件不存在");
  if (!isAdmin && row.userId !== userId) forbidden("无法访问这个附件");
  return row;
}

export async function dataUrlForAttachment(
  id: string,
  userId: string,
  isAdmin: boolean
): Promise<string> {
  const row = await attachmentForUser(id, userId, isAdmin);
  const data = await readFile(row.storagePath);
  return `data:${row.mimeType};base64,${data.toString("base64")}`;
}
