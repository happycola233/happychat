import { Fragment, useEffect, useRef, type ComponentType } from 'react'
import { clsx } from 'clsx'
import { Info, MessageCircle, MessageSquareText, Palette, Share2, UserRound, X } from 'lucide-react'
import { useSettingsDialog, type SettingsTab } from '../store/settingsDialog'
import { AboutPanel } from './settings/AboutPanel'
import { AccountPanel } from './settings/AccountPanel'
import { AppearancePanel } from './settings/AppearancePanel'
import { ChatPanel } from './settings/ChatPanel'
import { MessagesPanel } from './settings/MessagesPanel'
import { SharesPanel } from './settings/SharesPanel'

interface SettingsTabItem {
  id: SettingsTab
  label: string
  icon: ComponentType<{ className?: string }>
  panel: ComponentType
}

/** 导航按「偏好 / 账户与数据 / 关于」分组，桌面端组间以留白分隔。 */
const TAB_GROUPS: readonly (readonly SettingsTabItem[])[] = [
  [
    { id: 'appearance', label: '外观', icon: Palette, panel: AppearancePanel },
    { id: 'chat', label: '聊天', icon: MessageCircle, panel: ChatPanel },
    { id: 'messages', label: '消息显示', icon: MessageSquareText, panel: MessagesPanel },
  ],
  [
    { id: 'account', label: '账户', icon: UserRound, panel: AccountPanel },
    { id: 'shares', label: '我的分享', icon: Share2, panel: SharesPanel },
  ],
  [{ id: 'about', label: '关于', icon: Info, panel: AboutPanel }],
]

const TABS = TAB_GROUPS.flat()

function CloseButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/[0.05] hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/70 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200',
        className,
      )}
      aria-label="关闭"
    >
      <X className="h-[18px] w-[18px]" />
    </button>
  )
}

/**
 * 设置弹窗：桌面端左侧分组导航 + 右侧内容，手机端全屏、导航改为顶部横向滚动的页签。
 * 各页内容拆在 ./settings/* 中，本组件只负责外壳、页签与关闭行为。
 */
export function SettingsDialog() {
  const { open, tab, closeDialog, setTab } = useSettingsDialog()
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 设置页上层可能叠加分享设置弹窗/确认框等模态，让最上层模态自行处理 Escape。
      if (document.querySelector('[aria-modal="true"]')) return
      closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDialog])

  useEffect(() => {
    if (!open) return
    contentRef.current?.scrollTo({ top: 0 })
  }, [open, tab])

  if (!open) return null

  const active = TABS.find((item) => item.id === tab) ?? TABS[0]!
  const ActivePanel = active.panel

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center sm:p-6"
      data-testid="settings-dialog"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDialog} />
      <div
        role="dialog"
        aria-label="设置"
        className="hc-pop-in relative z-10 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-neutral-900 sm:h-[min(44rem,calc(100dvh-3rem))] sm:max-w-[54rem] sm:flex-row sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-black/[0.06] dark:sm:ring-white/10"
      >
        {/* 导航与内容共用同一底色，只用一条细线分隔（手机端在页签下方），不叠加色块。 */}
        <aside className="flex shrink-0 flex-col border-b border-black/[0.06] dark:border-white/[0.07] sm:w-52 sm:border-b-0 sm:border-r">
          <div className="flex h-14 shrink-0 items-center justify-between pl-[1.375rem] pr-3 sm:h-16">
            <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
              设置
            </h2>
            <CloseButton onClose={closeDialog} className="sm:hidden" />
          </div>

          <nav
            aria-label="设置分类"
            className="hc-scrollbar-hidden flex gap-1 overflow-x-auto px-3 pb-2 sm:flex-col sm:gap-0.5 sm:overflow-visible sm:pb-4"
          >
            {TAB_GROUPS.map((group, groupIndex) => (
              <Fragment key={group[0]!.id}>
                {groupIndex > 0 && <div aria-hidden="true" className="hidden h-4 sm:block" />}
                {group.map((item) => {
                  const Icon = item.icon
                  const selected = item.id === active.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setTab(item.id)}
                      className={clsx(
                        'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-[7px] text-left text-[14px] leading-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400/70',
                        selected
                          ? 'bg-black/[0.06] font-medium text-neutral-900 dark:bg-white/10 dark:text-white'
                          : 'text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-white',
                      )}
                    >
                      <Icon
                        className={clsx(
                          'h-4 w-4 shrink-0',
                          selected
                            ? 'text-neutral-800 dark:text-neutral-100'
                            : 'text-neutral-400 dark:text-neutral-500',
                        )}
                      />
                      {item.label}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 手机端顶部页签已标明当前页，不再重复标题。 */}
          <header className="hidden h-16 shrink-0 items-center justify-between pl-8 pr-4 sm:flex">
            <h3 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
              {active.label}
            </h3>
            <CloseButton onClose={closeDialog} />
          </header>
          <div
            ref={contentRef}
            className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-3 sm:px-8 sm:pt-1"
          >
            <ActivePanel />
          </div>
        </section>
      </div>
    </div>
  )
}
