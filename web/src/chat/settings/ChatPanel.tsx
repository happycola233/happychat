import type { TimelineNavPosition } from '@shared/types/domain'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { useSettings } from '../../store/settings'
import { useIsMobile } from '../../store/sidebar'
import { PrefToggleRow, SettingsRow } from './SettingsControls'

const TIMELINE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
] as const satisfies readonly { value: TimelineNavPosition | 'off'; label: string }[]

/** 「聊天」页：发送、附件与浏览对话时的交互行为。 */
export function ChatPanel() {
  const isMobile = useIsMobile()
  const showTimelineNav = useSettings((s) => s.preferences.showTimelineNav)
  const timelineNavPosition = useSettings((s) => s.preferences.timelineNavPosition)
  const setPreferences = useSettings((s) => s.setPreferences)

  return (
    <div className="space-y-9">
      <SettingsSection title="发送消息">
        <PrefToggleRow
          prefKey="sendOnEnterDesktop"
          title="电脑上按 Enter 发送"
          description="Shift + Enter 换行；关闭后 Enter 换行，Ctrl/⌘ + Enter 发送。"
        />
        <PrefToggleRow
          prefKey="sendOnEnterMobile"
          title="手机上按 Enter 发送"
          description="关闭时 Enter 换行，点击发送按钮发送。"
        />
      </SettingsSection>

      <SettingsSection title="上传附件" description="仅对之后上传的文件生效。">
        <PrefToggleRow
          prefKey="compressUploadedImages"
          title="压缩图片"
          description="保持原始分辨率，以几乎察觉不到的压缩减小体积，降低发送失败的可能。关闭后上传原图。"
        />
        <PrefToggleRow
          prefKey="convertOfficeToPdf"
          title="将 Word 与 PowerPoint 转为 PDF"
          description="兼容更多模型（部分模型只能读取 PDF 文档），并让模型看到每一页的真实样子，包括排版、图表和幻灯片设计，而不只是其中的文字。页面画面会占用更多 Token，关闭后上传原文件。"
        />
      </SettingsSection>

      <SettingsSection title="浏览对话">
        <PrefToggleRow
          prefKey="autoScrollOnOpen"
          title="打开对话时显示最新消息"
          description="关闭后从对话开头的第一条消息开始显示。"
        />
        <PrefToggleRow prefKey="showScrollToBottom" title="显示「滚动到底部」按钮" />
        {/* 时间轴只在桌面端显示，手机上不提供这一项。 */}
        {!isMobile && (
          <SettingsRow
            title="消息时间轴"
            description="悬停预览每轮问答，点击跳转或收藏。"
            control={
              <SegmentedControl<TimelineNavPosition | 'off'>
                label="消息时间轴"
                tone="neutral"
                value={showTimelineNav ? timelineNavPosition : 'off'}
                onChange={(position) =>
                  setPreferences(
                    position === 'off'
                      ? { showTimelineNav: false }
                      : { showTimelineNav: true, timelineNavPosition: position },
                  )
                }
                options={TIMELINE_OPTIONS}
              />
            }
          />
        )}
      </SettingsSection>
    </div>
  )
}
