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
  { value: 'small', label: '较小' },
  { value: 'medium', label: '标准' },
  { value: 'large', label: '较大' },
] as const satisfies readonly { value: MessageFontSize; label: string }[]

function ThemeSelect() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <PreferenceSelect<ThemePreference, (typeof THEME_OPTIONS)[number]>
      ariaLabel="颜色模式"
      value={theme}
      onChange={setTheme}
      options={THEME_OPTIONS}
      menuClassName="w-40"
      leading={({ icon: Icon }) => (
        <Icon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
      )}
    />
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
      title="聊天区域宽度"
      description="让消息与输入框在大屏幕上占用更多空间，宽度随窗口大小自动调整。"
      control={
        <div className="flex items-center gap-2">
          {!isDefault && (
            <button
              type="button"
              onClick={() => setPreference('chatWidth', DEFAULT_PREFERENCES.chatWidth)}
              aria-label="恢复默认宽度"
              title="恢复默认"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:bg-black/[0.05] hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
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
            className="hc-range w-40"
            style={{ '--hc-range-ratio': value / 100 } as CSSProperties}
          />
          <span className="w-9 shrink-0 text-right text-[13px] tabular-nums text-neutral-500 dark:text-neutral-400">
            {valueText}
          </span>
        </div>
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
    <div className="space-y-10">
      <SettingsSection title="主题">
        <SettingsRow title="颜色模式" control={<ThemeSelect />} />
        <SettingsRow title="重点色" control={<AccentColorPicker />} />
      </SettingsSection>

      <SettingsSection title="聊天区域">
        <SettingsRow
          title="消息字号"
          control={
            <PreferenceSelect<MessageFontSize>
              ariaLabel="消息字号"
              value={fontSize}
              onChange={(v) => setPreference('messageFontSize', v)}
              options={FONT_SIZE_OPTIONS}
              menuClassName="w-32"
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
