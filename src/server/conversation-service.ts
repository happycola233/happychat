import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  conversationNodes,
  conversations,
  messages,
  type MessageRow,
  type NodeRow
} from "./db/schema.js";
import { notFound } from "./errors.js";

export async function loadConversationForUser(
  conversationId: string,
  userId: string,
  isAdmin: boolean
) {
  const where = isAdmin
    ? eq(conversations.id, conversationId)
    : and(eq(conversations.id, conversationId), eq(conversations.userId, userId));
  const row = (await db.select().from(conversations).where(where).limit(1))[0];
  if (!row) notFound("会话不存在");
  return row;
}

export async function loadConversationGraph(conversationId: string): Promise<{
  nodes: NodeRow[];
  messages: MessageRow[];
}> {
  const nodes = await db
    .select()
    .from(conversationNodes)
    .where(eq(conversationNodes.conversationId, conversationId))
    .orderBy(asc(conversationNodes.createdAt));
  const messageIds = nodes.map((node) => node.messageId).filter((id): id is string => Boolean(id));
  const rows =
    messageIds.length > 0
      ? await db.select().from(messages).where(inArray(messages.id, messageIds))
      : [];
  return { nodes, messages: rows };
}

export function buildActivePath(nodes: NodeRow[], leafId: string | null): NodeRow[] {
  if (!leafId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: NodeRow[] = [];
  let current: NodeRow | undefined = byId.get(leafId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

export async function nextBranchIndex(
  conversationId: string,
  parentId: string | null
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(conversationNodes)
    .where(
      parentId
        ? and(
            eq(conversationNodes.conversationId, conversationId),
            eq(conversationNodes.parentId, parentId)
          )
        : and(
            eq(conversationNodes.conversationId, conversationId),
            isNull(conversationNodes.parentId)
          )
    );
  return Number(rows[0]?.value ?? 0);
}

export async function messagePathForLeaf(
  conversationId: string,
  leafId: string
): Promise<MessageRow[]> {
  const { nodes, messages: allMessages } = await loadConversationGraph(conversationId);
  const path = buildActivePath(nodes, leafId);
  const byId = new Map(allMessages.map((message) => [message.id, message]));
  return path
    .map((node) => (node.messageId ? byId.get(node.messageId) : undefined))
    .filter(Boolean) as MessageRow[];
}

export function compactTitle(content: string): string {
  const title = content.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, 36) : "新的对话";
}
