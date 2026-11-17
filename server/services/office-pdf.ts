import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OFFICE_PDF_SOURCE_EXTENSION_BY_MIME } from '@shared/util/fileTypes'
import { env } from '../env'
import { createConcurrencyLimit } from '../lib/concurrency'
import { withFileExtension, type UploadContent } from '../lib/upload-content'

// 上游对 Word / PowerPoint 只抽取文字；PDF 则同时提供文字与每页渲染图，模型能看到版面、图表与幻灯片画面。
// 大型演示文稿转换时 LibreOffice 峰值内存可达数百 MB，串行执行避免多个进程同时占满服务器内存。
const runConversion = createConcurrencyLimit(1)
// 几十 MB、上百页的演示文稿在低配服务器上可能需要一两分钟；超时后保留原文件。
const CONVERSION_TIMEOUT_MS = 180_000
const VERSION_PROBE_TIMEOUT_MS = 30_000
const OUTPUT_TAIL_CHARS = 2000

/** 未配置时：Windows 使用默认安装目录下会等待转换结束的控制台版 soffice.com，其他平台从 PATH 查找。 */
function libreOfficeCommand(): string {
  if (env.LIBREOFFICE_PATH) return env.LIBREOFFICE_PATH
  if (process.platform === 'win32') return 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
  if (process.platform === 'darwin') return '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  return 'soffice'
}

/** 超时需要结束整棵进程树：soffice 只是启动器，真正干活的 soffice.bin 是它的子进程。 */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    // 进程已自行退出。
  }
}

/** 运行一次 LibreOffice 命令并返回合并后的输出尾部（用于版本号与失败诊断）。 */
function runLibreOffice(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(libreOfficeCommand(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // POSIX 下让子进程自成进程组，超时时才能连同 soffice.bin 一起终止。
      detached: process.platform !== 'win32',
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      killProcessTree(child)
      reject(new Error(`LibreOffice 执行超过 ${timeoutMs / 1000} 秒`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(output.trim())
      else reject(new Error(`LibreOffice 异常退出（${code ?? signal}）：${output.trim()}`))
    })
  })
}

/**
 * 把 Word / PowerPoint 转为 PDF；非这四种格式或转换失败（未安装 LibreOffice、文件损坏或加密、超时）
 * 时返回 null，调用方保留原文件，上游仍可读取其中文字。
 */
export async function convertOfficeToPdf(upload: UploadContent): Promise<UploadContent | null> {
  const extension = OFFICE_PDF_SOURCE_EXTENSION_BY_MIME[upload.mime]
  if (!extension) return null

  return runConversion(async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'happychat-office-'))
    try {
      // 固定的 ASCII 文件名避免中文或特殊字符文件名在命令行与临时目录中出现编码问题。
      // 不强制指定导入过滤器：不少 .doc 实为 HTML / RTF，交给 LibreOffice 按内容识别才能正确转换。
      const sourcePath = join(workDir, `source${extension}`)
      await writeFile(sourcePath, upload.buffer)
      const output = await runLibreOffice(
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          // 每次转换使用独立的临时用户配置：互不共享状态，异常终止也不会留下影响后续转换的锁文件。
          `-env:UserInstallation=${pathToFileURL(join(workDir, 'profile')).href}`,
          '--convert-to',
          'pdf',
          '--outdir',
          workDir,
          sourcePath,
        ],
        CONVERSION_TIMEOUT_MS,
      )
      // 文件无法打开时 soffice 仍以 0 退出，只能以输出文件是否存在判断成败。
      const buffer = await readFile(join(workDir, 'source.pdf')).catch(() => {
        throw new Error(`LibreOffice 未生成 PDF：${output}`)
      })
      return {
        buffer,
        filename: withFileExtension(upload.filename, '.pdf'),
        mime: 'application/pdf',
      }
    } catch (error) {
      console.error(
        `文档转 PDF 失败，保留原文件（${upload.mime}，${upload.buffer.length} 字节）：`,
        error instanceof Error ? error.message : error,
      )
      return null
    } finally {
      // Windows 上 soffice.bin 可能在启动器退出后短暂占用文件，给删除留出重试余地。
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}

/** 返回 LibreOffice 版本信息；无法运行时返回 null。 */
export async function libreOfficeVersion(): Promise<string | null> {
  return runLibreOffice(['--version'], VERSION_PROBE_TIMEOUT_MS).catch(() => null)
}

/** 启动时探测一次并写日志，便于部署后确认文档转换是否可用；探测结果不影响服务启动与上传。 */
export async function logOfficePdfConverterStatus(): Promise<void> {
  const version = await libreOfficeVersion()
  if (version) console.log(`文档转 PDF 已就绪：${version}`)
  else {
    console.warn(
      `文档转 PDF 不可用：未能运行 LibreOffice（${libreOfficeCommand()}），Word / PowerPoint 文件将按原格式上传。`,
    )
  }
}
