import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminQuotaPolicyDTO } from '@shared/types/api'
import {
  createQuotaPolicy,
  listAdminModelGroups,
  listAdminModels,
  updateQuotaPolicy,
} from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { QuotaPolicyNavigation } from './QuotaPolicyNavigation'
import { describeQuotaPolicyBrief } from './quotaPolicyDisplay'
import { QuotaRuleList } from './QuotaRuleList'
import { draftFromRule, draftsToRules, type QuotaRuleDraft } from './quotaRuleDrafts'

interface Props {
  /** null=新建 */
  policy: AdminQuotaPolicyDTO | null
  policies: AdminQuotaPolicyDTO[]
  /** 切换到另一个策略；null=新建 */
  onSelectPolicy: (policyId: string | null) => void
  onClose: () => void
}

/**
 * 额度策略工作台：左栏切换策略，右侧编辑名称与规则。切换策略只重建表单，
 * 有未保存的修改时先询问保存还是放弃。
 *
 * 「零规则 = 不限额」是显式设计：策略里没有任何规则时直接说明，
 * 而不是让管理员填一个很大的数字来模拟不限额。
 */
export function QuotaPolicyEditor(props: Props) {
  return <QuotaPolicyForm key={props.policy?.id ?? 'new'} {...props} />
}

function QuotaPolicyForm({ policy, policies, onSelectPolicy, onClose }: Props) {
  const queryClient = useQueryClient()
  const isCreate = policy === null
  const [name, setName] = useState(policy?.name ?? '')
  const [description, setDescription] = useState(policy?.description ?? '')
  const [drafts, setDrafts] = useState<QuotaRuleDraft[]>(
    () => policy?.rules.map(draftFromRule) ?? [],
  )
  const [invalid, setInvalid] = useState<{ index: number; message: string } | null>(null)
  /** 等待确认的切换目标；undefined=没有待切换，null=新建 */
  const [switchTarget, setSwitchTarget] = useState<string | null | undefined>(undefined)

  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: listAdminModelGroups,
  })

  const snapshot = JSON.stringify({ name, description, drafts })
  const initialSnapshot = useRef(snapshot)
  const dirty = snapshot !== initialSnapshot.current

  const save = useMutation({
    /** next：保存后切换到的策略；undefined=留在当前策略。 */
    mutationFn: async (next?: string | null) => {
      const result = draftsToRules(drafts)
      if (!result.ok) {
        setInvalid({ index: result.index, message: result.message })
        throw new Error(`第 ${result.index + 1} 条规则：${result.message}`)
      }
      setInvalid(null)
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        rules: result.rules,
      }
      const saved = policy
        ? await updateQuotaPolicy(policy.id, payload)
        : await createQuotaPolicy({ ...payload, isDefault: false })
      return { saved, next }
    },
    onSuccess: async ({ saved, next }) => {
      toast.success(isCreate ? '已创建策略' : '已保存')
      initialSnapshot.current = snapshot
      setSwitchTarget(undefined)
      void queryClient.invalidateQueries({ queryKey: ['quota', 'me'] })
      // 等列表刷新后再切换，新建的策略才能在左栏和表单里找到。
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quota'] })
      if (next !== undefined) onSelectPolicy(next)
      else if (isCreate) onSelectPolicy(saved.id)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  const canSave = Boolean(name.trim()) && !save.isPending
  const requestClose = async () => {
    if (
      !dirty ||
      (await askConfirm({
        title: '放弃未保存的修改？',
        description: '本次修改尚未保存。',
        confirmLabel: '放弃修改',
      }))
    )
      onClose()
  }
  const switchTo = (next: string | null) => {
    if (save.isPending || next === (policy?.id ?? null)) return
    if (dirty) setSwitchTarget(next)
    else onSelectPolicy(next)
  }
  const switchTargetName =
    switchTarget === null
      ? '新策略'
      : (policies.find((item) => item.id === switchTarget)?.name ?? '另一个策略')

  return (
    <>
      <Modal
        open
        animate={false}
        onClose={() => void requestClose()}
        dismissible={!save.isPending}
        title={isCreate ? '新建额度策略' : `额度策略 · ${policy.name}`}
        size="workspace"
        height="workspace"
        // 宽屏下正文不整体滚动：名称固定在上方，规则列表与编辑区各自滚动。
        bodyClassName="hc-scrollbar overflow-y-auto px-5 py-4 sm:px-6 lg:flex lg:flex-col lg:overflow-hidden"
        sidebar={
          <QuotaPolicyNavigation
            policies={policies}
            currentId={policy?.id ?? null}
            creating={isCreate}
            onSelect={(item) => switchTo(item.id)}
            onCreate={() => switchTo(null)}
            disabled={save.isPending}
          />
        }
        navigation={
          policies.length > 0 ? (
            <div className="md:hidden">
              <Select
                aria-label="切换额度策略"
                className="w-full"
                value={policy?.id ?? ''}
                disabled={save.isPending}
                options={[
                  { value: '', label: '新建策略' },
                  ...policies.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: describeQuotaPolicyBrief(item),
                  })),
                ]}
                onChange={(event) => switchTo(event.target.value || null)}
              />
            </div>
          ) : undefined
        }
        footer={
          <>
            <span className="mr-auto hidden self-center text-xs text-neutral-400 sm:block">
              {dirty ? '有未保存的修改' : 'Ctrl / ⌘ + Enter 保存'}
            </span>
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => void requestClose()}
            >
              {dirty ? '取消' : '关闭'}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!canSave || (!dirty && !isCreate)}
              onClick={() => save.mutate(undefined)}
            >
              {isCreate ? '创建' : '保存'}
            </Button>
          </>
        }
      >
        <fieldset
          className="min-w-0 space-y-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
          disabled={save.isPending}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSave) {
              event.preventDefault()
              save.mutate(undefined)
            }
          }}
        >
          <div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <TextField
                label="策略名称"
                value={name}
                maxLength={40}
                autoFocus={isCreate}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：默认用户 / VIP / 朋友"
              />
              <TextField
                label="备注"
                value={description}
                maxLength={200}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="可选，仅管理员可见"
              />
            </div>
            {policy && (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                {policy.isDefault && (
                  <span className="mr-1.5 rounded bg-sky-100 px-1.5 py-px text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                    默认策略
                  </span>
                )}
                {policy.isDefault
                  ? `没有单独指定策略的用户都使用它，共 ${policy.boundUserCount} 人。`
                  : `${policy.boundUserCount} 位用户使用这个策略。`}
              </p>
            )}
          </div>

          <QuotaRuleList
            title="规则"
            description="仅用户发起的对话与生图计入，标题总结不计入任何额度规则。同级规则同时生效，任意一条用完即限制。"
            emptyMessage={
              <>
                还没有规则，使用这个策略的用户
                <span className="font-medium text-neutral-700 dark:text-neutral-200">不限额</span>
                。点这里添加第一条规则。
              </>
            }
            emptyUnlimited
            fill
            drafts={drafts}
            onChange={(next) => {
              setDrafts(next)
              setInvalid(null)
            }}
            models={models ?? []}
            groups={groups ?? []}
            invalidIndex={invalid?.index ?? null}
            invalidMessage={invalid?.message}
          />
        </fieldset>
      </Modal>
      {switchTarget !== undefined && (
        <Modal
          open
          title="切换前保存修改？"
          onClose={() => setSwitchTarget(undefined)}
          dismissible={!save.isPending}
          footer={
            <div className="flex w-full flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => setSwitchTarget(undefined)}
              >
                继续编辑
              </Button>
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => onSelectPolicy(switchTarget)}
              >
                放弃并切换
              </Button>
              <Button
                disabled={!canSave}
                loading={save.isPending}
                onClick={() => save.mutate(switchTarget)}
              >
                保存并切换
              </Button>
            </div>
          }
        >
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            「{name.trim() || '新策略'}」有未保存的修改。下一个是「{switchTargetName}」。
          </p>
        </Modal>
      )}
    </>
  )
}
