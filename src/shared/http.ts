export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: { message: string; code?: string } };
export type ApiResult<T> = ApiOk<T> | ApiFail;

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function fail(message: string, code?: string): ApiFail {
  return { ok: false, error: { message, code } };
}
