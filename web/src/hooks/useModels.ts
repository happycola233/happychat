import { useQuery } from '@tanstack/react-query'
import type { LobeIconCatalogDTO, ModelDTO, ModelGroupDTO } from '@shared/types/api'
import { listLobeIcons, listModels } from '../api/models'

/** 目录在 queryFn 中只归一化一次，所有 ModelIconMark 共享 Query cache 里的同一份索引。 */
export interface LobeIconCatalog {
  version: string
  monoBySlug: Readonly<Record<string, boolean>>
  slugs: readonly string[]
}

export function buildLobeIconCatalog(data: LobeIconCatalogDTO): LobeIconCatalog {
  return {
    version: data.version,
    monoBySlug: Object.fromEntries(data.icons.map((icon) => [icon.slug, icon.mono])),
    slugs: data.icons.map((icon) => icon.slug),
  }
}

async function loadLobeIconCatalog(): Promise<LobeIconCatalog> {
  return buildLobeIconCatalog(await listLobeIcons())
}

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
 * 内置图标目录：判断某个 slug 是单色（CSS mask）还是彩色，并为长缓存 URL 提供版本号。
 * 内容随依赖版本固定，缓存到会话结束即可，不必反复校验。
 */
export function useLobeIconCatalog() {
  return useQuery({
    queryKey: ['lobe-icons'],
    queryFn: loadLobeIconCatalog,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}
