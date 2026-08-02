import type { ReactNode } from 'react'

const standardLabelClass =
  'mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300'

/**
 * 标准字段。简单控件可隐式嵌套；包含多个交互元素的复合控件必须传 htmlFor，
 * 避免浏览器把标签点击错误转发给复合控件中的第一个按钮。
 */
export function Field({
  label,
  children,
  htmlFor,
}: {
  label: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  if (htmlFor) {
    return (
      <div className="block">
        <label className={standardLabelClass} htmlFor={htmlFor}>
          {label}
        </label>
        {children}
      </div>
    )
  }

  return (
    <label className="block">
      <span className={standardLabelClass}>{label}</span>
      {children}
    </label>
  )
}

/** 紧凑字段：xs 标签（参数、定价这类次级输入）。 */
export function SmallField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
