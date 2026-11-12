import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import type { MaintenanceNotice } from '@shared/schemas/maintenance'
import { AuthThemeToggle } from '../components/auth/AuthThemeToggle'
import { MaintenanceArt } from './MaintenanceArt'
import {
  MAINTENANCE_COPY,
  formatExpectedEnd,
  maintenanceLanguages,
  maintenanceNote,
} from './maintenanceCopy'

interface Props {
  notice: MaintenanceNotice
  /** 正文下方的操作入口（登录 / 切换账号）；后台预览不传。 */
  footer?: ReactNode
}

/**
 * 维护页：左对齐的单列排版，插画在上、正文在下；中英双语时两段文字上下排列。
 * 只负责展示，何时出现由 MaintenanceGate 决定，后台预览也直接复用它。
 */
export function MaintenancePage({ notice, footer }: Props) {
  const now = Date.now()
  return (
    <div className="hc-maint relative flex min-h-full flex-col">
      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <AuthThemeToggle />
      </div>

      <main className="flex flex-1 items-center px-6 py-20 sm:px-10">
        <div className="mx-auto w-full max-w-[33rem]">
          <MaintenanceArt className="-ml-3 h-32 w-32 sm:h-36 sm:w-36" />

          {maintenanceLanguages(notice.language).map((language, index) => {
            const copy = MAINTENANCE_COPY[language]
            const note = maintenanceNote(notice, language)
            const expectedEnd = formatExpectedEnd(notice.expectedEndAt, language, now)
            const Title = index === 0 ? 'h1' : 'h2'
            return (
              <section
                key={language}
                lang={copy.locale}
                className={clsx(
                  'hc-maint-in',
                  index === 0 ? 'mt-7' : 'mt-10 border-t border-[var(--hc-maint-line)] pt-10',
                )}
                style={{ animationDelay: `${0.25 + index * 0.12}s` }}
              >
                <Title className="hc-maint-title">{copy.title}</Title>
                <div className="mt-5 space-y-3.5 text-[16px] leading-[1.75]">
                  <p>{copy.body}</p>
                  {note && <p className="whitespace-pre-line">{note}</p>}
                  {expectedEnd && <p>{expectedEnd}</p>}
                </div>
                <p className="hc-maint-thanks mt-6 text-[16px]">{copy.thanks}</p>
              </section>
            )
          })}

          {footer && (
            <div className="hc-maint-in mt-12 text-[13px]" style={{ animationDelay: '0.5s' }}>
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
