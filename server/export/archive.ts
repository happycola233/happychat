import { zip, type AsyncZippable } from 'fflate'

export interface ZipEntry {
  /** ZIP 内相对路径（/ 分隔） */
  path: string
  data: Uint8Array
}

/** 本身已压缩的常见格式：ZIP 里存储即可，避免白费 CPU。 */
const PRECOMPRESSED_EXT = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|7z|rar|mp3|mp4|m4a|mov|webm|woff2?|pdf)$/i

/** 异步打包（fflate 在 worker 线程压缩，不冻结事件循环）。 */
export function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const tree: AsyncZippable = {}
  for (const e of entries) {
    tree[e.path] = [e.data, { level: PRECOMPRESSED_EXT.test(e.path) ? 0 : 6 }]
  }
  return new Promise((resolve, reject) => {
    zip(tree, (err, data) => (err ? reject(err) : resolve(data)))
  })
}
