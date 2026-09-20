import { stringify } from 'yaml'
import type { ExportOptions } from '@shared/schemas/export'
import type { ContentPart, ProcessStep, UrlCitation } from '@shared/types/domain'
import { safeHttpUrl } from '@shared/util/url'
import {
  attachmentDisplayName,
  attachmentRefsOf,
  dedupeCitations,
  encodeAssetHref,
  exportProcessSteps,
  sanitizeLinkText,
  sanitizeLinkUrl,
} from './content'
import { formatLocalDate, formatStamp } from './time'
import type { ExportMessage, ExportSource } from './types'
import { prepareChatlogText } from './chatlog-body'

type Metadata = Record<string, unknown>

/** chatlog-md/2：消息元数据独立、有序过程不合并，正文与附件保持原有位置。 */
export function buildChatlogMd(source: ExportSource, options: ExportOptions): string {
  const front = stringify(
    {
      format: 'chatlog-md/2',
      title: source.title,
      timezone: source.timezone,
      'x-happychat': { exported_at: new Date(source.exportedAt).toISOString() },
    },
    // 文档头禁止多行标量，避免其中的独占 --- 被阅读器误认成 front matter 结尾。
    { lineWidth: 0, blockQuote: false },
  )
  const blocks = [`---\n${front}---`]
  let currentDate: string | null = null
  for (const message of source.messages) {
    if (options.timePrecision !== 'none') {
      const date = formatLocalDate(message.createdAt, source.timezone)
      if (date !== currentDate) {
        currentDate = date
        blocks.push(`# @${date}`)
      }
    }
    blocks.push(renderMessage(message, source, options))
  }
  return `${blocks.join('\n\n')}\n`
}

/** 双引号 YAML 保留换行、类型和控制字符；HTML 注释结束符必须转义而非替换原文。 */
function metadataBlock(meta: Metadata): string {
  const yaml = stringify(meta, {
    lineWidth: 0,
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  }).replace(/-->/g, '--\\u003e')
  return `<!-- @meta\n${yaml}-->`
}

function explicitPart(kind: string, rawText = '', data: Metadata = {}): string {
  const prepared = prepareChatlogText(rawText)
  const meta = { ...data }
  // V2 读取器规范化正文外围空行和 CRLF；仅这些字节确有区别时补原文快照。
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  const originalText = prepared.originalText ?? (rawText !== normalized ? rawText : undefined)
  if (originalText !== undefined) {
    meta['x-happychat'] = { original_text: originalText }
  }
  return [
    `<!-- @part ${kind} -->`,
    ...(Object.keys(meta).length ? [metadataBlock(meta)] : []),
    ...(prepared.text ? [prepared.text] : []),
    '<!-- @endpart -->',
  ].join('\n')
}

function renderMessage(
  message: ExportMessage,
  source: ExportSource,
  options: ExportOptions,
): string {
  const role =
    message.role === 'user' ? '🧑‍💻 @user' : message.role === 'system' ? '⚙️ @system' : '🤖 @ai'
  const stamp =
    options.timePrecision === 'none'
      ? ''
      : ` · ${formatStamp(message.createdAt, source.timezone, options.timePrecision)}`
  const meta: Metadata = { id: message.id }
  const recorded = message.chatlogMetadata
  if (options.includeModel && message.role === 'assistant') {
    if (recorded?.model) meta.model = recorded.model
    else if (message.modelLabel) meta.model = { name: message.modelLabel }
  }
  if (options.includeReasoning && recorded?.reasoning) meta.reasoning = recorded.reasoning
  if (options.includeUsage && recorded?.usage) meta.usage = recorded.usage

  const generation: Metadata = {}
  if (message.role === 'assistant') generation.status = message.status
  if (message.errorMessage) generation.error = message.errorMessage
  if (options.includeUsage && message.generationDurationMs != null) {
    generation.duration_ms = message.generationDurationMs
  }
  // 这是整条回复的过程耗时，不能重复冒充每个 reasoning 块各自的耗时。
  if (options.includeReasoning && message.reasoningDurationMs != null) {
    generation.reasoning_duration_ms = message.reasoningDurationMs
  }
  if (Object.keys(generation).length) meta['x-generation'] = generation

  const blocks = [`## ${role}${stamp}\n${metadataBlock(meta)}`]
  if (message.role === 'assistant') {
    for (const step of exportProcessSteps(
      message,
      options.includeReasoning,
      options.includeSearch,
    )) {
      blocks.push(processPart(step))
    }
  }
  for (const part of message.content) {
    if (part.type === 'input_text' || part.type === 'output_text') {
      const text = part.text
      if (!text) continue
      const citations =
        options.includeCitations && part.type === 'output_text'
          ? citationRecords(part.annotations)
          : []
      const partMeta: Metadata = {}
      if (part.type === 'output_text' && part.phase) partMeta['x-phase'] = part.phase
      if (citations.length) partMeta['x-citations'] = citations
      blocks.push(explicitPart('answer', text, partMeta))
    } else if (options.attachmentMode !== 'omit') {
      blocks.push(attachmentPart(part, source, options))
    }
  }
  if (options.includeCitations) {
    const citations = citationRecords(message.annotations)
    if (citations.length) {
      const lines = [
        '**来源**',
        '',
        ...dedupeCitations(citations).map(
          (citation, index) =>
            `${index + 1}. [${sanitizeLinkText(citation.title || citation.url)}](${sanitizeLinkUrl(citation.url)})`,
        ),
      ]
      // 引用列表独立于原回答，不把它伪造为某次搜索的结果或个人批注。
      blocks.push(explicitPart('x-citations', lines.join('\n'), { results: citations }))
    }
  }
  return blocks.join('\n\n')
}

/** 显示列表可以去重，但结构化引用需保留同一 URL 在正文中的每次定位。 */
function citationRecords(citations: UrlCitation[] | null | undefined): UrlCitation[] {
  return (
    citations?.flatMap((citation) => {
      const url = safeHttpUrl(citation.url)
      return url ? [{ ...citation, url }] : []
    }) ?? []
  )
}

function processPart(step: ProcessStep): string {
  if (step.kind !== 'search') return explicitPart(step.kind, step.text)
  const kind =
    step.action.type === 'open_page' || step.action.type === 'find_in_page'
      ? step.action.type
      : 'search'
  return explicitPart(kind, '', { action: step.action })
}

function attachmentPart(part: ContentPart, source: ExportSource, options: ExportOptions): string {
  const ref = attachmentRefsOf([part])[0]!
  const attachment = source.attachments.get(ref.attachmentId)
  const name = attachmentDisplayName(ref, attachment)
  const path =
    options.attachmentMode === 'embed' && attachment && !attachment.missing
      ? attachment.assetPath
      : null
  // 普通附件沿用易读简写；特殊文件名和生成图使用结构化属性，避免改名或截断提示词。
  if (!ref.generated && name.trim() === name && !/[[\]\r\n\u2028\u2029]/.test(name)) {
    const icon = ref.kind === 'image' ? '🖼️' : '📄'
    return path ? `${icon} [${name}](${encodeAssetHref(path)})` : `${icon} ${name}`
  }
  const meta: Metadata = {}
  if (ref.generated) {
    meta['x-generation'] = {
      generated: true,
      ...(ref.revisedPrompt != null ? { revised_prompt: ref.revisedPrompt } : {}),
    }
  }
  return explicitPart('attachment', '', {
    kind: ref.kind,
    name,
    path: path ? encodeAssetHref(path) : null,
    ...(Object.keys(meta).length ? { meta } : {}),
  })
}
