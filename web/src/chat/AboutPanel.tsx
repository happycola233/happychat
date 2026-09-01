import { useMemo, useState, type ComponentType } from 'react'
import {
  BookOpen,
  Bug,
  Check,
  Copy,
  GitBranch,
  Globe,
  Heart,
  Image as ImageIcon,
  Share2,
  Zap,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SettingsSection } from '../components/ui/SettingsSection'
import { APP_ICON_SRC } from '../lib/appIcon'
import { APP_VERSION, BUILD_TIME } from '../lib/buildInfo'
import { copyToClipboard } from '../lib/clipboard'
import { describeClientEnv } from '../lib/clientEnv'
import { formatDateTime } from '../lib/format'
import { toast } from '../store/toast'
import { ExternalLinkIcon, GithubIcon, ReasoningEffortIcon } from './icons'

const REPO_URL = 'https://github.com/happycola233/happychat'

/** 「推理强度可调」沿用输入框里「推理强度」最高档的图标，与聊天界面保持同一套视觉语言。 */
function ReasoningIcon({ className }: { className?: string }) {
  return <ReasoningEffortIcon effort="max" className={className} />
}

/** 技术栈标签：与 README「技术架构」一节保持一致。 */
const TECH_STACK = ['React 19', 'TypeScript', 'Vite', 'Tailwind CSS v4', 'Hono', 'SQLite'] as const

/** 功能亮点：一句话说清「用户能怎么用」，不写实现细节，也不把 README 整段搬进设置弹窗。 */
const HIGHLIGHTS: readonly {
  icon: ComponentType<{ className?: string }>
  title: string
  desc: string
}[] = [
  {
    icon: Zap,
    title: '流式输出与断线续传',
    desc: '回答实时流式输出，刷新页面或网络中断后可自动续接未完成的生成。',
  },
  {
    icon: GitBranch,
    title: '对话分支',
    desc: '编辑消息不会覆盖原内容，而是在该位置创建子分支；同时支持在对话任意位置分支创建新对话。',
  },
  {
    icon: ReasoningIcon,
    title: '推理强度',
    desc: '可视化调节推理强度，以精致的交互界面实时展示推理摘要。',
  },
  {
    icon: Globe,
    title: '联网搜索',
    desc: '一键可视化控制是否启用模型内置的联网搜索。',
  },
  {
    icon: ImageIcon,
    title: '多模态与图片生成',
    desc: '支持图片与文件输入，并为图片生成提供可视化面板，可直观选择分辨率与画质。',
  },
  {
    icon: Share2,
    title: '分享与公告',
    desc: '支持快照式分享完整对话或部分消息，并提供 Markdown 渲染与多种通知形式的站内公告系统。',
  },
]

const LINKS: readonly {
  href: string
  title: string
  desc: string
  icon: ComponentType<{ className?: string }>
}[] = [
  {
    href: REPO_URL,
    title: 'GitHub 仓库',
    desc: '浏览源码与更新记录，欢迎 Star ⭐',
    icon: GithubIcon,
  },
  {
    href: `${REPO_URL}/issues`,
    title: '反馈问题或提建议',
    desc: '提交 Issue 时建议附上下方运行环境',
    icon: Bug,
  },
  {
    href: `${REPO_URL}#-快速开始`,
    title: '部署与使用文档',
    desc: '快速开始、生产部署与设计取舍',
    icon: BookOpen,
  },
]

/** 「关于」页的运行环境行：左标签右值，值使用等宽字体便于比对与复制。 */
function EnvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-[12px] text-neutral-700 dark:text-neutral-200">
        {value}
      </dd>
    </div>
  )
}

/**
 * 设置 → 关于：应用身份区（图标 / 名称 / 简介 / 技术栈）+ 功能亮点 + 相关链接 + 运行环境。
 * 版本号只在「运行环境」里出现一次，运行环境可一键复制，方便用户在 Issue 里粘贴排障信息。
 */
export function AboutPanel() {
  const [copied, setCopied] = useState(false)
  // UA 在会话期内不变，挂载时取一次即可。
  const clientEnv = useMemo(() => describeClientEnv(), [])
  const buildTimeLabel = BUILD_TIME ? formatDateTime(BUILD_TIME) : '未知'

  const copyEnvReport = () => {
    const report = [
      `HappyChat v${APP_VERSION}`,
      `构建时间：${buildTimeLabel}`,
      `浏览器：${clientEnv.browser}`,
      `操作系统：${clientEnv.os}`,
      `User-Agent：${navigator.userAgent}`,
    ].join('\n')
    void copyToClipboard(report).then((ok) => {
      if (!ok) {
        toast.error('复制失败')
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="pb-2 pt-1">
      {/* 身份区：不套卡片、不用渐变，居中留白即可，避免与下方分组内容抢视觉重心 */}
      <section className="flex flex-col items-center px-4 pb-2 pt-2 text-center">
        {/* 图标只描一圈细边界定轮廓，不加投影，免得显得「浮」在页面上 */}
        <img
          src={APP_ICON_SRC}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 rounded-[18px] ring-1 ring-black/5 dark:ring-white/10"
        />
        <h4 className="mt-3.5 text-[17px] font-semibold tracking-wide text-neutral-900 dark:text-neutral-50">
          HappyChat
        </h4>
        {/* 版本号不在这里重复展示，下方「运行环境」已有一行 */}
        <p className="mt-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
          开源、可自托管的全功能 AI 聊天站
        </p>
        <p className="mt-3 max-w-[30rem] text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
          服务端统一代理多家上游模型，实时流式回传浏览器，内置断线续传、对话分支、思考模型、联网搜索与图片生成，配套完整管理后台。
        </p>
        {/* 技术栈用「·」连接成一行，比一排药丸标签更安静 */}
        <p className="mt-3 text-[11px] text-neutral-400 dark:text-neutral-500">
          {TECH_STACK.join(' · ')}
        </p>
      </section>

      <SettingsSection title="功能亮点">
        <div className="grid gap-x-5 gap-y-3.5 py-3 sm:grid-cols-2">
          {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
                  {title}
                </div>
                <div className="mt-0.5 text-[12px] leading-5 text-neutral-500 dark:text-neutral-400">
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="相关链接">
        <div className="-mx-2 py-1.5">
          {LINKS.map(({ icon: LinkIcon, ...link }) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
            >
              <LinkIcon className="h-[18px] w-[18px] shrink-0 text-neutral-500 dark:text-neutral-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
                  {link.title}
                </div>
                <div className="truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                  {link.desc}
                </div>
              </div>
              <ExternalLinkIcon className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-300" />
            </a>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="运行环境"
        description="遇到问题时，复制这段信息附在反馈里能大幅加快定位。"
      >
        <div className="py-2">
          <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <EnvRow label="应用版本" value={`v${APP_VERSION}`} />
            <EnvRow label="构建时间" value={buildTimeLabel} />
            <EnvRow label="浏览器" value={clientEnv.browser} />
            <EnvRow label="操作系统" value={clientEnv.os} />
          </dl>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={copyEnvReport}>
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? '已复制' : '复制环境信息'}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <p className="flex items-center justify-center gap-1.5 pb-1 text-[12px] text-neutral-400 dark:text-neutral-500">
        Made with <Heart className="h-3.5 w-3.5 text-rose-400" /> · 欢迎 Issue 与 PR
      </p>
    </div>
  )
}
