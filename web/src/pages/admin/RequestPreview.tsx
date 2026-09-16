import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Copy, FileJson2 } from 'lucide-react'
import { clsx } from 'clsx'
import { requestPreviewSchema, type RequestPreviewInput } from '@shared/schemas/request-preview'
import { requestPreviewCurl } from './requestPreviewCurl'
import { previewModelRequest } from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Select } from '../../components/ui/Select'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Spinner } from '../../components/ui/Spinner'
import { inputClass } from '../../components/ui/controlStyles'
import { toast } from '../../store/toast'

function JsonCode({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2)
  const tokens = text.split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi,
  )
  return (
    <pre
      className="m-0 min-w-0 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-neutral-600 hc-scrollbar dark:text-neutral-300 sm:px-4 sm:text-xs"
      tabIndex={0}
      aria-label="请求 JSON"
    >
      <code>
        {tokens.map((token, index) => (
          <span
            key={index}
            className={clsx(
              token.startsWith('"') &&
                (token.trimEnd().endsWith(':')
                  ? 'text-sky-700 dark:text-sky-300'
                  : token.includes('⟪')
                    ? 'text-violet-600 dark:text-violet-300'
                    : 'text-emerald-700 dark:text-emerald-300'),
              /^(true|false|null|-?\d)/.test(token) && 'text-amber-700 dark:text-amber-300',
            )}
          >
            {token}
          </span>
        ))}
      </code>
    </pre>
  )
}

type PreviewDraft = Omit<RequestPreviewInput['model'], 'hardParams'> & { hardParamsText: string }

export function RequestPreview({ draft }: { draft: PreviewDraft }) {
  const [tab, setTab] = useState<'body' | 'headers' | 'parameters'>('body')
  const [includeHistory, setIncludeHistory] = useState(true)
  const [includeImage, setIncludeImage] = useState(false)
  const [includeFile, setIncludeFile] = useState(false)
  const [effort, setEffort] = useState('')
  const [webSearch, setWebSearch] = useState('')
  const [xSearch, setXSearch] = useState('')
  const [userParamsText, setUserParamsText] = useState('')
  const [copied, setCopied] = useState<'json' | 'curl' | null>(null)
  const serializedDraft = JSON.stringify({
    draft,
    includeHistory,
    includeImage,
    includeFile,
    effort,
    webSearch,
    xSearch,
    userParamsText,
  })
  const [settledDraft, setSettledDraft] = useState(serializedDraft)
  useEffect(() => {
    const timer = setTimeout(() => setSettledDraft(serializedDraft), 250)
    return () => clearTimeout(timer)
  }, [serializedDraft])
  const validation = useMemo(() => {
    const state = JSON.parse(settledDraft) as {
      draft: PreviewDraft
      includeHistory: boolean
      includeImage: boolean
      includeFile: boolean
      effort: string
      webSearch: string
      xSearch: string
      userParamsText: string
    }
    let hardParams: unknown
    let userParams: Record<string, unknown>
    try {
      hardParams = state.draft.hardParamsText.trim() ? JSON.parse(state.draft.hardParamsText) : null
    } catch {
      return { error: '高级参数 JSON 尚未完整，请先在「高级」中修正。' }
    }
    try {
      const parsed: unknown = state.userParamsText.trim() ? JSON.parse(state.userParamsText) : {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { error: '用户参数应为 JSON 对象。' }
      userParams = parsed as Record<string, unknown>
    } catch {
      return { error: '用户参数 JSON 尚未完整。' }
    }
    if (state.effort) userParams.reasoning_effort = state.effort
    if (state.webSearch) userParams.web_search = state.webSearch === 'on'
    if (state.xSearch) userParams.x_search = state.xSearch === 'on'
    const parsed = requestPreviewSchema.safeParse({
      model: {
        ...state.draft,
        hardParams,
        displayName: state.draft.displayName || state.draft.modelId,
      },
      userParams,
      includeHistory: state.includeHistory,
      includeImage:
        state.includeImage && (state.draft.kind === 'image' || state.draft.capabilities.vision),
      includeFile:
        state.includeFile && state.draft.capabilities.file_input && state.draft.kind !== 'image',
    })
    return parsed.success
      ? { input: parsed.data }
      : { error: parsed.error.issues[0]?.message ?? '请先完善模型配置。' }
  }, [settledDraft])
  const preview = useQuery({
    queryKey: ['admin', 'request-preview', validation.input],
    queryFn: () => previewModelRequest(validation.input!),
    enabled: Boolean(validation.input),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const pending = serializedDraft !== settledDraft || preview.isFetching
  const data = validation.input ? preview.data : undefined
  const error = validation.error || (preview.error instanceof Error ? preview.error.message : '')
  const copy = async (format: 'json' | 'curl') => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(
        format === 'curl'
          ? requestPreviewCurl(data)
          : JSON.stringify(tab === 'headers' ? data.headers : data.body, null, 2),
      )
      setCopied(format)
    } catch {
      toast.error('复制失败，请选择内容后手动复制')
    }
  }
  const searchOptions = [
    { value: '', label: '跟随模型默认' },
    { value: 'on', label: '开启' },
    { value: 'off', label: '关闭' },
  ]
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          发往上游的请求
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          查看当前配置最终如何发送，也可以模拟用户的选择。
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300">
          {draft.kind !== 'image' && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={includeHistory}
                onChange={() => setIncludeHistory(!includeHistory)}
              />
              携带历史消息
            </label>
          )}
          {(draft.capabilities.vision || draft.kind === 'image') && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={includeImage} onChange={() => setIncludeImage(!includeImage)} />
              {draft.kind === 'image' ? '携带参考图' : '携带图片'}
            </label>
          )}
          {draft.capabilities.file_input && draft.kind !== 'image' && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={includeFile} onChange={() => setIncludeFile(!includeFile)} />
              携带文件
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {draft.capabilities.reasoning && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="shrink-0">思考强度</span>
              <Select
                className="w-36"
                size="sm"
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
                options={[
                  { value: '', label: '跟随模型默认' },
                  ...draft.allowedEfforts.map((option) => ({
                    value: option.value,
                    label: option.description || option.value,
                  })),
                ]}
              />
            </label>
          )}
          {draft.capabilities.web_search && draft.kind !== 'chat' && draft.kind !== 'image' && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="shrink-0">联网搜索</span>
              <Select
                className="w-36"
                size="sm"
                value={webSearch}
                onChange={(event) => setWebSearch(event.target.value)}
                options={searchOptions}
              />
            </label>
          )}
          {draft.capabilities.x_search && draft.kind === 'responses' && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="shrink-0">X 搜索</span>
              <Select
                className="w-36"
                size="sm"
                value={xSearch}
                onChange={(event) => setXSearch(event.target.value)}
                options={searchOptions}
              />
            </label>
          )}
        </div>
        <details className="group text-xs">
          <summary className="w-fit cursor-pointer py-0.5 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            模拟更多用户参数
          </summary>
          <textarea
            aria-label="模拟用户参数 JSON"
            className={`${inputClass} mt-2 min-h-24 font-mono text-xs`}
            value={userParamsText}
            onChange={(event) => setUserParamsText(event.target.value)}
            placeholder={'例如 {"temperature":0.5,"max_output_tokens":4096}'}
            spellCheck={false}
          />
          <p className="mt-1.5 leading-5 text-neutral-400">
            只影响本次预览，不保存到模型。上方选择优先于此处相同参数。
          </p>
        </details>
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <FileJson2 className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : !data ? (
        <div className="py-12 text-center text-sm text-neutral-400">
          <Spinner className="mr-2 h-4 w-4" />
          正在构建请求
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5 text-xs">
            <span className="font-semibold tracking-wider text-emerald-700 dark:text-emerald-400">
              POST
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
            <code className="min-w-0 break-all font-mono text-neutral-600 dark:text-neutral-300">
              {data.url}
            </code>
            {pending && <Spinner className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
          </div>
          <div className="overflow-hidden rounded-xl bg-neutral-50 dark:bg-neutral-950/60">
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 pt-2.5">
              <SegmentedControl
                label="请求预览内容"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'body', label: '请求体' },
                  { value: 'headers', label: '请求头' },
                  { value: 'parameters', label: '参数来源' },
                ]}
              />
              <div className="flex items-center gap-1">
                {(['json', 'curl'] as const).map((format) => (
                  <Button
                    key={format}
                    variant="ghost"
                    className="!px-2 !py-1.5 text-[11px]"
                    title={
                      format === 'curl'
                        ? '复制完整 cURL 请求'
                        : tab === 'headers'
                          ? '复制请求头 JSON'
                          : '复制请求体 JSON'
                    }
                    disabled={pending}
                    onClick={() => void copy(format)}
                  >
                    {copied === format ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {format === 'json' ? 'JSON' : 'cURL'}
                  </Button>
                ))}
              </div>
            </div>
            <div
              className={clsx(
                'max-h-[52vh] min-h-40 overflow-auto hc-scrollbar',
                pending && 'opacity-60',
              )}
              aria-busy={pending}
            >
              {tab === 'body' ? (
                <JsonCode value={data.body} />
              ) : tab === 'headers' ? (
                <JsonCode value={data.headers} />
              ) : (
                <div className="space-y-3 px-3 py-2.5 sm:px-4">
                  {data.parameters.map((parameter) => (
                    <div
                      key={parameter.name}
                      className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-x-5"
                    >
                      <div>
                        <code className="break-all text-xs text-sky-700 dark:text-sky-300">
                          {parameter.name}
                        </code>
                        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          {parameter.source}
                        </p>
                      </div>
                      <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                        {parameter.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1 text-[11px] leading-[1.6] text-neutral-400 dark:text-neutral-500">
            {data.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
