import type { ModelIcon } from '../types/domain'

/**
 * 模型分组只有默认文件夹图形接受自定义颜色；选择显式图标后由图标自身决定外观。
 * 前端预览、用户端渲染与服务端 DTO/写入必须共用这一条规则，避免隐藏颜色日后意外复活。
 */
export function resolveModelGroupColor(
  icon: ModelIcon | null | undefined,
  color: string | null | undefined,
): string | null {
  return icon ? null : (color ?? null)
}
