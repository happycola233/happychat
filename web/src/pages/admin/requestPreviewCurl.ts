import type { RequestPreviewDTO } from '@shared/types/request-preview'

/** POSIX shell 引号仅用于展示和复制，不执行任何生成的命令。 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function requestPreviewCurl(preview: RequestPreviewDTO): string {
  return [
    `curl ${shellQuote(preview.url)}`,
    '  --request POST',
    ...Object.entries(preview.headers).map(
      ([name, value]) => `  --header ${shellQuote(`${name}: ${value}`)}`,
    ),
    `  --data-raw ${shellQuote(JSON.stringify(preview.body, null, 2))}`,
  ].join(' \\\n')
}
