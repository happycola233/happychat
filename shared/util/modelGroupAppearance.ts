import type { ModelGroupIcon } from '../types/domain'
import { DEFAULT_FOLDER_COLOR } from '../constants'

/**
 * 模型分组只有默认文件夹图形接受自定义颜色；选择显式图标或无图标模式后不再使用颜色。
 * 前端预览、用户端渲染与服务端 DTO/写入必须共用这一条规则，避免隐藏颜色日后意外复活。
 */
export function resolveModelGroupColor(
  icon: ModelGroupIcon | null | undefined,
  color: string | null | undefined,
): string | null {
  return icon ? null : (color ?? DEFAULT_FOLDER_COLOR)
}
