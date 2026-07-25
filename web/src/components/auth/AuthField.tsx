import { clsx } from 'clsx'
import { useId, useState } from 'react'
import type { ComponentType, InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  label: string
  /** 输入框内左侧的语义图标（lucide 或自绘，统一 16px）。 */
  icon: ComponentType<{ className?: string }>
  /** 校验错误：出现时接管描述行并把视觉盒转为错误态。 */
  error?: string
  /** 常态下的辅助说明（错误出现时被错误文案取代，避免两行同时占位）。 */
  hint?: ReactNode
  /** 标签行右侧的附加内容（如密码强度指示）。 */
  labelAside?: ReactNode
  /** 输入框右侧的内嵌动作（如「显示密码」），会自动为文字让出内边距。 */
  trailing?: ReactNode
  /** 输入框自身的附加类名（如邀请码的等宽大写排版）。 */
  inputClassName?: string
  /** 暴露 input 元素，供表单在校验失败时聚焦首个出错字段。 */
  inputRef?: RefObject<HTMLInputElement | null>
}

/**
 * 登录 / 注册专用输入字段：标签 + 图标输入框 + 单行描述。
 *
 * 与通用 `components/ui/TextField` 的区别：这里是登录场景的高一档排版（44px 高、
 * 左置语义图标、焦点色跟随重点色 token、接管浏览器自动填充配色），且描述行按
 * 「错误优先」只渲染一行，避免表单在报错时整体跳动。样式在 `index.css` 的
 * `.hc-auth-field*`（图标与右侧动作绝对定位、input 铺满视觉盒，见那里的注释）。
 */
export function AuthField({
  label,
  icon: Icon,
  error,
  hint,
  labelAside,
  trailing,
  inputClassName,
  inputRef,
  ...rest
}: Props) {
  const id = useId()
  const describedById = `${id}-desc`
  const description = error || hint

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[13px] font-medium text-neutral-700 dark:text-neutral-300"
        >
          {label}
        </label>
        {labelAside}
      </div>
      <div
        className="hc-auth-field"
        data-invalid={error ? '' : undefined}
        data-trailing={trailing ? '' : undefined}
      >
        <Icon className="hc-auth-field-icon h-4 w-4" />
        <input
          id={id}
          ref={inputRef}
          className={clsx('hc-auth-field-input', inputClassName)}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? describedById : undefined}
          {...rest}
        />
        {trailing}
      </div>
      {description && (
        <p
          id={describedById}
          className={clsx(
            'mt-1.5 text-[12px] leading-5',
            error ? 'text-rose-600 dark:text-rose-400' : 'text-neutral-400 dark:text-neutral-500',
          )}
        >
          {description}
        </p>
      )}
    </div>
  )
}

/** 密码字段：在 `AuthField` 上叠加「显示 / 隐藏」切换，明文态不改动 autoComplete。 */
export function AuthPasswordField(props: Omit<Props, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  const ToggleIcon = visible ? EyeOff : Eye
  const toggleLabel = visible ? '隐藏密码' : '显示密码'

  return (
    <AuthField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          // 纯视觉辅助，不进 Tab 序列——否则从密码框按 Tab 会落在眼睛上而不是提交按钮。
          tabIndex={-1}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
        >
          <ToggleIcon className="h-4 w-4" />
        </button>
      }
    />
  )
}
