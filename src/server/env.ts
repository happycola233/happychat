import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const generatedPath = resolve("data/.generated-env");

function ensureSecret(name: string, bytes: number): string {
  const value = process.env[name];
  if (value && !value.startsWith("change-me")) return value;
  const generatedValue = readGeneratedSecret(name);
  if (generatedValue) {
    process.env[name] = generatedValue;
    return generatedValue;
  }
  const generated = crypto.randomBytes(bytes).toString("base64url");
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, `${name}=${generated}\n`, { flag: "a", encoding: "utf8" });
  process.env[name] = generated;
  return generated;
}

function readGeneratedSecret(name: string): string | null {
  if (!existsSync(generatedPath)) return null;
  const lines = readFileSync(generatedPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

export const env = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173",
  appSecret: ensureSecret("APP_SECRET", 32),
  encryptionKey: ensureSecret("ENCRYPTION_KEY", 32),
  databasePath: resolve(process.env.DATABASE_PATH ?? "./data/happychat.sqlite"),
  uploadDir: resolve(process.env.UPLOAD_DIR ?? "./data/uploads"),
  nodeEnv: process.env.NODE_ENV ?? "development"
};
