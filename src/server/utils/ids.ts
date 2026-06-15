import { customAlphabet } from "nanoid";

const id = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 18);

export function newId(prefix: string): string {
  return `${prefix}_${id()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
