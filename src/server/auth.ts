import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import bcrypt from "bcryptjs";
import { and, count, eq, gt, or } from "drizzle-orm";
import { db } from "./db/index.js";
import { inviteCodes, sessions, userPreferences, users } from "./db/schema.js";
import { newId, nowIso } from "./utils/ids.js";
import { forbidden, unauthorized } from "./errors.js";
import type { PublicUser, UserRole } from "../shared/types.js";
import { publicUser } from "./mappers.js";

export type AppVariables = {
  user: PublicUser;
};

export const sessionCookie = "happychat_session";
const sessionDays = 30;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function sessionExpiresAt(): string {
  return new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
}

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, sessionCookie, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/",
    maxAge: sessionDays * 24 * 60 * 60
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, sessionCookie, { path: "/" });
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = newId("sess");
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt: sessionExpiresAt()
  });
  return sessionId;
}

export async function getCurrentUser(c: Context): Promise<PublicUser | null> {
  const sessionId = getCookie(c, sessionCookie);
  if (!sessionId) return null;
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, nowIso())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  return publicUser(row.user);
}

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = await getCurrentUser(c);
  if (!user) unauthorized();
  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = await getCurrentUser(c);
  if (!user) unauthorized();
  if (user.role !== "admin") forbidden("只有管理员可以访问这里");
  c.set("user", user);
  await next();
};

export async function userCount(): Promise<number> {
  const rows = await db.select({ value: count() }).from(users);
  return rows[0]?.value ?? 0;
}

export async function consumeInvite(code: string): Promise<void> {
  const invite = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
  const row = invite[0];
  if (!row) forbidden("邀请码不存在");
  if (row.disabled) forbidden("邀请码已停用");
  if (row.uses >= row.maxUses) forbidden("邀请码已使用完");
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) forbidden("邀请码已过期");
  await db
    .update(inviteCodes)
    .set({ uses: row.uses + 1 })
    .where(eq(inviteCodes.code, code));
}

export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
  inviteCode?: string;
}): Promise<PublicUser> {
  const existingCount = await userCount();
  const role: UserRole = existingCount === 0 ? "admin" : "user";
  if (existingCount > 0) {
    if (!input.inviteCode) forbidden("注册需要邀请码");
    await consumeInvite(input.inviteCode);
  }
  const id = newId("usr");
  const passwordHash = await hashPassword(input.password);
  await db.insert(users).values({
    id,
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash,
    role,
    status: "active"
  });
  await db.insert(userPreferences).values({ userId: id }).onConflictDoNothing();
  const row = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return publicUser(row[0]);
}

export async function authenticate(email: string, password: string): Promise<PublicUser> {
  const row = (
    await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  )[0];
  if (!row || !(await verifyPassword(password, row.passwordHash))) unauthorized("邮箱或密码不正确");
  if (row.status !== "active") forbidden("账号已被停用");
  return publicUser(row);
}

export async function logoutCurrent(c: Context): Promise<void> {
  const sessionId = getCookie(c, sessionCookie);
  if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
  clearSessionCookie(c);
}

export async function canAccessConversation(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const rows = await db
    .select({ value: count() })
    .from(users)
    .where(or(eq(users.id, userId), eq(users.role, "admin")));
  return rows.length >= 0 && Boolean(conversationId);
}
