import type { MessageTimeFormat } from '@shared/types/domain'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { useLocalDate } from '../../hooks/useLocalDate'
import { useSettings } from '../../store/settings'
import { formatMessageTime } from '../messageTime'
import { PreferenceSelect, PrefToggleRow, SettingsRow } from './SettingsControls'

function MessageTimeFormatSelect() {
  const { today, timeZone } = useLocalDate()
  const messageTimeFormat = useSettings((s) => s.preferences.messageTimeFormat)
  const setPreference = useSettings((s) => s.setPreference)
  const previewDate = new Date(today)
  previewDate.setHours(14, 32)
  const previewTimestamp = previewDate.getTime()

  return (
    <PreferenceSelect<MessageTimeFormat>
      ariaLabel="消息时间格式"
      value={messageTimeFormat}
      onChange={(v) => setPreference('messageTimeFormat', v)}
      menuClassName="w-72 max-w-[calc(100vw-3rem)]"
      options={[
        {
          value: 'smart',
          label: '智能',
          description: `今天 ${formatMessageTime(previewTimestamp, 'smart', today, timeZone)} · 昨天 14:32 · 10月12日 14:32`,
        },
        {
          value: 'time',
          label: '仅时间',
          description: `${formatMessageTime(previewTimestamp, 'time', today, timeZone)} · 按天分组`,
        },
        {
          value: 'datetime',
          label: '完整日期时间',
          description: formatMessageTime(previewTimestamp, 'datetime', today, timeZone),
        },
      ]}
    />
  )
}

/** 「消息显示」页：消息附带的信息，以及回答过程与 Artifacts 的展示方式。 */
export function MessagesPanel() {
  const showMessageTime = useSettings((s) => s.preferences.showMessageTime)

  return (
    <div className="space-y-10">
      <SettingsSection title="消息信息">
        <PrefToggleRow
          prefKey="showMessageTime"
          title="显示消息时间"
          description="悬停或点按时间可查看完整日期。"
        />
        {showMessageTime && <SettingsRow title="时间格式" control={<MessageTimeFormatSelect />} />}
        <PrefToggleRow
          prefKey="showModelLabel"
          title="显示模型名称"
          description="在助手消息下方显示回答所用的模型。"
        />
        <PrefToggleRow
          prefKey="showUsageStats"
          title="显示用量明细"
          description="Token（含缓存写入与读取）、生成速度与耗时。"
        />
      </SettingsSection>

      <SettingsSection title="回答内容">
        <PrefToggleRow
          prefKey="defaultExpandReasoning"
          title="生成时展开思考过程"
          description="生成中自动展开思考过程与检索明细，正式回答开始后自动折叠。"
        />
        <PrefToggleRow
          prefKey="autoRunArtifacts"
          title="自动运行 Artifacts"
          description="图表、几何图形与交互演示滚动到附近时自动运行，关闭后需点击「运行」。Artifacts 在隔离环境中运行，无法访问你的账号与聊天记录。"
        />
        <PrefToggleRow
          prefKey="copyWithFormatting"
          title="复制时保留格式"
          description="复制回答或选中文字时附带排版，粘贴到 Word 会保留标题、列表与可编辑公式。关闭后只复制纯文本，公式为 LaTeX 源码，适合粘贴到 Obsidian、Typora 等 Markdown 笔记。"
        />
      </SettingsSection>
    </div>
  )
}
