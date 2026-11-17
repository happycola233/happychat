import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { clsx } from 'clsx'
import { Check, Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import type {
  AccentColor,
  MessageFontSize,
  NewChatGlowColor,
  ThemePreference,
} from '@shared/types/domain'
import { CHAT_WIDTH_RANGE, DEFAULT_PREFERENCES } from '@shared/util/preferences'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { applyChatWidth } from '../../lib/theme'
import { useIsDark } from '../../lib/useIsDark'
import { useSettings } from '../../store/settings'
import { useIsMobile } from '../../store/sidebar'
import { PreferenceSelect, PrefToggleRow, SettingsRow } from './SettingsControls'

const ACCENT_OPTIONS = [
  { value: 'default', label: '默认', light: '#b4b4b4', dark: '#9b9b9b' },
  { value: 'blue', label: '蓝色', light: '#3a83f7', dark: '#2c67c5' },
  { value: 'green', label: '绿色', light: '#53b559', dark: '#48a04c' },
  { value: 'yellow', label: '黄色', light: '#f6c543', dark: '#d9a337' },
  { value: 'pink', label: '粉色', light: '#e0766d', dark: '#c96257' },
  { value: 'orange', label: '橙色', light: '#ee7c37', dark: '#d25e28' },
  { value: 'purple', label: '紫色', light: '#8952ee', dark: '#7849d1' },
] as const satisfies readonly {
  value: AccentColor
  label: string
  light: string
  dark: string
}[]

const GLOW_COLOR_OPTIONS = [
  { value: 'accent', label: '跟随重点色' },
  ...ACCENT_OPTIONS.filter((option) => option.value !== 'default'),
] as const

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: unknown }[]

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
] as const satisfies readonly { value: MessageFontSize; label: string }[]

/** 主题缩略图配色：只示意明暗关系，不追求与真实界面逐像素一致。 */
const THUMB_PALETTES = {
  light: {
    sidebar: '#f3f3f3',
    main: '#ffffff',
    line: '#e3e3e3',
    bubble: '#ececec',
    composer: '#ececec',
  },
  dark: {
    sidebar: '#0b0b0b',
    main: '#1a1a1a',
    line: '#3a3a3a',
    bubble: '#2f2f2f',
    composer: '#2a2a2a',
  },
} as const

function ThemeThumb({
  palette,
}: {
  palette: (typeof THUMB_PALETTES)[keyof typeof THUMB_PALETTES]
}) {
  return (
    <span className="absolute inset-0 flex" style={{ backgroundColor: palette.main }}>
      <span
        className="flex w-[27%] flex-col gap-1 p-1.5"
        style={{ backgroundColor: palette.sidebar }}
      >
        {[80, 62, 70].map((width) => (
          <span
            key={width}
            className="h-1 rounded-full"
            style={{ width: `${width}%`, backgroundColor: palette.line }}
          />
        ))}
      </span>
      <span className="flex flex-1 flex-col px-[9%] pb-1.5 pt-2">
        <span
          className="ml-auto h-2 w-[42%] rounded-full"
          style={{ backgroundColor: palette.bubble }}
        />
        <span
          className="mt-1.5 h-1 w-full rounded-full"
          style={{ backgroundColor: palette.line }}
        />
        <span className="mt-1 h-1 w-[66%] rounded-full" style={{ backgroundColor: palette.line }} />
        <span
          className="mt-auto h-2.5 rounded-full"
          style={{ backgroundColor: palette.composer }}
        />
      </span>
    </span>
  )
}

function ThemePicker() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <div role="radiogroup" aria-label="主题" className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className="group min-w-0 rounded-xl text-left focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              className={clsx(
                'relative block aspect-[16/10] overflow-hidden rounded-[10px] transition group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-focus-visible:ring-neutral-400 dark:group-focus-visible:ring-offset-neutral-900',
                active
                  ? 'ring-2 ring-[var(--hc-accent-strong)]'
                  : 'ring-1 ring-black/10 group-hover:ring-black/25 dark:ring-white/10 dark:group-hover:ring-white/25',
              )}
            >
              {value === 'dark' ? (
                <ThemeThumb palette={THUMB_PALETTES.dark} />
              ) : (
                <ThemeThumb palette={THUMB_PALETTES.light} />
              )}
              {/* 跟随系统：斜切一半叠上深色缩略图，示意随系统明暗切换。 */}
              {value === 'system' && (
                <span className="absolute inset-0 [clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]">
                  <ThemeThumb palette={THUMB_PALETTES.dark} />
                </span>
              )}
            </span>
            <span
              className={clsx(
                'mt-2 flex items-center gap-1.5 px-0.5 text-[13px] leading-5',
                active
                  ? 'font-medium text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-500 group-hover:text-neutral-800 dark:text-neutral-400 dark:group-hover:text-neutral-200',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function AccentColorPicker() {
  const value = useSettings((s) => s.preferences.accentColor)
  const setPreference = useSettings((s) => s.setPreference)
  const isDark = useIsDark()

  return (
    <div role="radiogroup" aria-label="重点色" className="flex flex-wrap items-center gap-2">
      {ACCENT_OPTIONS.map((option) => {
        const active = option.value === value
        const swatch = isDark ? option.dark : option.light
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setPreference('accentColor', option.value)}
            // outline-offset 留出的空隙透出卡片底色，选中环不必猜测背景色。
            className={clsx(
              'flex h-6 w-6 items-center justify-center rounded-full outline-offset-2 transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-neutral-400',
              active && 'outline-2 outline-solid',
            )}
            style={{ backgroundColor: swatch, outlineColor: active ? swatch : undefined }}
          >
            {active && (
              <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_0_1px_rgb(0_0_0/0.35)]" />
            )}
          </button>
        )
      })}
    </div>
  )
}

function GlowColorSelect() {
  const value = useSettings((s) => s.preferences.newChatGlowColor)
  const accentColor = useSettings((s) => s.preferences.accentColor)
  const setPreference = useSettings((s) => s.setPreference)
  const isDark = useIsDark()
  const accentOption = ACCENT_OPTIONS.find((option) => option.value === accentColor)!

  return (
    <PreferenceSelect<NewChatGlowColor, (typeof GLOW_COLOR_OPTIONS)[number]>
      ariaLabel="光晕颜色"
      value={value}
      onChange={(color) => setPreference('newChatGlowColor', color)}
      options={GLOW_COLOR_OPTIONS}
      menuClassName="w-56"
      menuPlacement="top"
      leading={(option) => {
        const swatch = option.value === 'accent' ? accentOption : option
        return (
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: isDark ? swatch.dark : swatch.light }}
          />
        )
      }}
    />
  )
}

/** 宽度示意图：细线框代表聊天区，框内一问一答与输入框随滑块实时伸缩；只用一层描边，内部全是平涂。 */
function ChatWidthPreview({ chatWidth }: { chatWidth: number }) {
  const ratio = chatWidth / 100
  return (
    <div
      aria-hidden="true"
      className="flex h-[5.25rem] rounded-xl px-3 ring-1 ring-inset ring-black/[0.08] dark:ring-white/[0.09]"
    >
      <div
        className="mx-auto flex w-full flex-col py-2.5 transition-[max-width] duration-200 ease-out motion-reduce:transition-none"
        style={{ maxWidth: `${40 + ratio * 60}%` }}
      >
        <span className="ml-auto h-3 w-2/5 rounded-full bg-black/[0.07] dark:bg-white/[0.12]" />
        <span className="mt-2 h-1.5 w-full rounded-full bg-black/[0.07] dark:bg-white/[0.1]" />
        <span className="mt-1.5 h-1.5 w-[86%] rounded-full bg-black/[0.07] dark:bg-white/[0.1]" />
        <span className="mt-auto h-3.5 rounded-full bg-black/[0.05] dark:bg-white/[0.07]" />
      </div>
    </div>
  )
}

function ChatWidthRow() {
  const stored = useSettings((s) => s.preferences.chatWidth)
  const setPreference = useSettings((s) => s.setPreference)
  // 拖动中的临时值：只实时改 CSS 变量预览，松手后才写入设置并同步服务端，避免拖动时连发请求。
  const [draft, setDraft] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const value = draft ?? stored

  useEffect(() => {
    const input = inputRef.current!
    // React 的 onChange 对应原生 input 事件（拖动中连续触发）；原生 change 只在松手或键盘调整后触发。
    const commit = () => {
      setPreference('chatWidth', Number(input.value))
      setDraft(null)
    }
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [setPreference])

  const isDefault = value === DEFAULT_PREFERENCES.chatWidth
  const valueText =
    value === CHAT_WIDTH_RANGE.min ? '标准' : value === CHAT_WIDTH_RANGE.max ? '铺满' : `${value}%`

  return (
    <SettingsRow
      layout="stacked"
      title="聊天区域宽度"
      description="让消息与输入框在大屏幕上占用更多空间，宽度随窗口大小自动调整。"
      aside={
        !isDefault && (
          <button
            type="button"
            onClick={() => setPreference('chatWidth', DEFAULT_PREFERENCES.chatWidth)}
            className="-mr-1.5 -mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-neutral-500 transition hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-100"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
        )
      }
      control={
        <>
          <ChatWidthPreview chatWidth={value} />
          <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="shrink-0">标准</span>
            <input
              ref={inputRef}
              type="range"
              min={CHAT_WIDTH_RANGE.min}
              max={CHAT_WIDTH_RANGE.max}
              step={CHAT_WIDTH_RANGE.step}
              value={value}
              aria-label="聊天区域宽度"
              aria-valuetext={valueText}
              onChange={(event) => {
                const next = Number(event.target.value)
                setDraft(next)
                applyChatWidth(next)
              }}
              className="hc-range min-w-0 flex-1"
              style={{ '--hc-range-ratio': value / 100 } as CSSProperties}
            />
            <span className="shrink-0">铺满</span>
          </div>
        </>
      }
    />
  )
}

export function AppearancePanel() {
  const isMobile = useIsMobile()
  const fontSize = useSettings((s) => s.preferences.messageFontSize)
  const showNewChatGradientGlow = useSettings((s) => s.preferences.showNewChatGradientGlow)
  const setPreference = useSettings((s) => s.setPreference)

  return (
    <div className="space-y-9">
      <SettingsSection title="主题">
        <div className="py-4">
          <ThemePicker />
        </div>
        <SettingsRow title="重点色" control={<AccentColorPicker />} />
      </SettingsSection>

      <SettingsSection title="聊天区域">
        <SettingsRow
          title="消息字号"
          control={
            <SegmentedControl<MessageFontSize>
              label="消息字号"
              tone="neutral"
              value={fontSize}
              onChange={(v) => setPreference('messageFontSize', v)}
              options={FONT_SIZE_OPTIONS}
            />
          }
        />
        {/* 窄屏下聊天列始终铺满，宽度与新聊天光晕都只在桌面端生效。 */}
        {!isMobile && <ChatWidthRow />}
      </SettingsSection>

      {!isMobile && (
        <SettingsSection title="新聊天">
          <PrefToggleRow
            prefKey="showNewChatGradientGlow"
            title="渐变光晕背景"
            description="在新聊天的输入框后方显示柔和的渐变光晕。"
          />
          {showNewChatGradientGlow && (
            <SettingsRow title="光晕颜色" control={<GlowColorSelect />} />
          )}
        </SettingsSection>
      )}
    </div>
  )
}
