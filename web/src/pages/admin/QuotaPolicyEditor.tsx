import { useState } from 'react'
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
import { TextField } from '../../components/ui/TextField'
import { toast } from '../../store/toast'
import { QuotaRuleList } from './QuotaRuleList'
import { draftFromRule, draftsToRules, type QuotaRuleDraft } from './quotaRuleDrafts'

interface Props {
  open: boolean
  /** null=新建 */
  policy: AdminQuotaPolicyDTO | null
  onClose: () => void
}

/**
 * 策略编辑弹窗（新建/编辑两用）。
 *
 * 「零规则 = 无限额度」是显式设计：策略里没有任何规则时给出明确说明，
 * 而不是让管理员填一个很大的数字来模拟不限额。
 */
export function QuotaPolicyEditor({ open, policy, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(policy?.name ?? '')
  const [description, setDescription] = useState(policy?.description ?? '')
  const [drafts, setDrafts] = useState<QuotaRuleDraft[]>(
    () => policy?.rules.map(draftFromRule) ?? [],
  )
  const [invalidIndex, setInvalidIndex] = useState<{ index: number; message: string } | null>(null)

  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: listAdminModelGroups,
  })

  const save = useMutation({
    mutationFn: async () => {
      const result = draftsToRules(drafts)
      if (!result.ok) {
        setInvalidIndex({ index: result.index, message: result.message })
        throw new Error(`第 ${result.index + 1} 条规则：${result.message}`)
      }
      setInvalidIndex(null)
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        rules: result.rules,
      }
      if (policy) return updateQuotaPolicy(policy.id, payload)
      return createQuotaPolicy({ ...payload, isDefault: false })
    },
    onSuccess: () => {
      toast.success('已保存')
      void queryClient.invalidateQueries({ queryKey: ['admin', 'quota'] })
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="form"
      title={policy ? `编辑策略 · ${policy.name}` : '新建限额策略'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="策略名称"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          placeholder="如：默认用户 / VIP / 朋友 / 测试账号"
        />
        <TextField
          label="备注"
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="可选，仅管理员可见"
        />

        <QuotaRuleList
          title="限额规则"
          description={
            <>
              同档优先级同时生效，任意一条达到上限即触发限制。拖动调整展示顺序，覆盖关系由优先级决定。
              仅用户发起的对话与生图计入，标题总结不计入任何额度规则。
            </>
          }
          emptyMessage={
            <>
              没有任何规则 ={' '}
              <span className="font-medium text-neutral-700 dark:text-neutral-200">无限额度</span>
              ，绑定该策略的用户不受用量限制。
            </>
          }
          emptyUnlimited
          drafts={drafts}
          onChange={(next) => {
            setDrafts(next)
            setInvalidIndex(null)
          }}
          models={models ?? []}
          groups={groups ?? []}
          invalidIndex={invalidIndex?.index ?? null}
          invalidMessage={invalidIndex?.message}
        />
      </div>
    </Modal>
  )
}
