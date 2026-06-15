import crypto from "node:crypto";
import { env } from "../env.js";

function key(): Buffer {
  return crypto.createHash("sha256").update(env.encryptionKey).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(value: string): string {
  const raw = Buffer.from(value, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function redactSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    return input
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [已隐藏]")
      .replace(/(api[_-]?key|token|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "$1: [已隐藏]");
  }
  if (Array.isArray(input)) return input.map(redactSecrets);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (/api[_-]?key|token|authorization|encryptedApiKey/i.test(k)) {
        out[k] = "[已隐藏]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return String(redactSecrets(error.message));
  return String(redactSecrets(error));
}
