import { AsyncZipDeflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'

export interface ZipEntry {
  /** ZIP 内相对路径（/ 分隔） */
  path: string
  data: Uint8Array
}

/** 本身已压缩的常见格式：ZIP 里存储即可，避免白费 CPU。 */
const PRECOMPRESSED_EXT = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|7z|rar|mp3|mp4|m4a|mov|webm|woff2?|pdf)$/i

/**
 * ZIP 中央目录的条目数字段是 16 位；fflate 不支持 ZIP64，
 * 超过 65535 个条目会静默产出解压为空的损坏文件，必须前置拒绝。
 */
export const ZIP_MAX_ENTRIES = 65_535

/** 超过该字节数的可压缩条目转入 worker 线程压缩（阈值与 fflate zip() 内部一致）。 */
const ASYNC_DEFLATE_MIN_BYTES = 160_000

/**
 * 打包 ZIP：基于 fflate 流式 Zip 逐条目推进——上一条完成后才开始下一条，
 * 同一时刻至多一个压缩 worker。一次性 zip() 会为每个大条目各起一个
 * worker 线程且无并发上限，条目多时会耗尽线程与内存。
 */
export function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  if (entries.length > ZIP_MAX_ENTRIES) {
    return Promise.reject(new Error(`ZIP 条目数超过上限（${entries.length} > ${ZIP_MAX_ENTRIES}）`))
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let settled = false
    const fail = (err: Error) => {
      if (!settled) {
        settled = true
        zip.terminate()
        reject(err)
      }
    }
    const zip = new Zip((err, chunk, final) => {
      if (err) return fail(err)
      chunks.push(chunk)
      if (final && !settled) {
        settled = true
        resolve(concat(chunks))
      }
    })
    void (async () => {
      try {
        for (const e of entries) await addEntry(zip, e)
        zip.end()
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })
}

/** 添加单个条目并等待其完成（压缩数据已全部交给 Zip 输出流）。 */
function addEntry(zip: Zip, e: ZipEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const stored = PRECOMPRESSED_EXT.test(e.path)
    const useWorker = !stored && e.data.length >= ASYNC_DEFLATE_MIN_BYTES
    const file = stored
      ? new ZipPassThrough(e.path)
      : useWorker
        ? new AsyncZipDeflate(e.path, { level: 6 })
        : new ZipDeflate(e.path, { level: 6 })
    zip.add(file)
    // Zip.add 会接管 file.ondata 消费压缩输出；再包一层以感知本条目完成
    const inner = file.ondata
    file.ondata = (err, dat, final) => {
      inner?.(err, dat, final)
      if (err) reject(err)
      else if (final) resolve()
    }
    // AsyncZipDeflate 会把缓冲区 transfer 给 worker（调用方数组被剥离），
    // 推副本以保住调用方数据（如 zipEntries 的 size 统计）
    file.push(useWorker ? e.data.slice() : e.data, true)
  })
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
