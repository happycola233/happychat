import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { fail } from "../shared/http.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message, "bad_request");
}

export function unauthorized(message = "请先登录"): never {
  throw new HttpError(401, message, "unauthorized");
}

export function forbidden(message = "没有权限执行此操作"): never {
  throw new HttpError(403, message, "forbidden");
}

export function notFound(message = "资源不存在"): never {
  throw new HttpError(404, message, "not_found");
}

export function jsonError(c: Context, error: unknown): Response {
  if (error instanceof HttpError) {
    return c.json(fail(error.message, error.code), error.status as ContentfulStatusCode);
  }
  console.error(error);
  return c.json(fail("服务器开小差了，请稍后再试", "internal_error"), 500);
}
