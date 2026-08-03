import { useQuery } from '@tanstack/react-query'
import type { ModelDTO, ModelGroupDTO } from '@shared/types/api'
import { listLobeIcons, listModels } from '../api/models'

/**
 * 模型列表。签名保持返回 `ModelDTO[]`——分组是后加的，改这里的形状会波及全部调用点，
 * 因此分组由下方 `useModelGroups()` 从同一份查询里取，两者永远同源同帧。
 */
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    select: (data): ModelDTO[] => data.models,
  })
}

export function useModelGroups() {
  return useQuery({
    queryKey: ['models'],
    queryFn: listModels,
    select: (data): ModelGroupDTO[] => data.groups,
  })
}

/**
 * 内置图标目录：只用来判断某个 slug 是单色（CSS mask 渲染，随主题变色）还是彩色（<img>）。
 * 内容随依赖版本固定，缓存到会话结束即可，不必反复校验。
 */
export function useLobeIconCatalog() {
  return useQuery({
    queryKey: ['lobe-icons'],
    queryFn: listLobeIcons,
    staleTime: Infinity,
    gcTime: Infinity,
    select: (data) => new Map(data.icons.map((icon) => [icon.slug, icon.mono])),
  })
}
