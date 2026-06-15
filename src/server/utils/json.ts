import type { JsonObject } from "../../shared/types.js";

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function deepMerge<T extends JsonObject>(
  ...objects: Array<JsonObject | undefined | null>
): T {
  const output: JsonObject = {};
  for (const object of objects) {
    if (!object) continue;
    for (const [key, value] of Object.entries(object)) {
      const existing = output[key];
      if (isPlain(existing) && isPlain(value)) {
        output[key] = deepMerge(existing as JsonObject, value as JsonObject);
      } else {
        output[key] = value;
      }
    }
  }
  return output as T;
}

function isPlain(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
