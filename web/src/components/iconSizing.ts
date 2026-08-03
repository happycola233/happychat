export type IconSize = 'xs' | 'sm' | 'md' | 'lg'

/** 裸图标的统一实际尺寸；容器与图形同尺寸，不包含额外留白。 */
export const ICON_SIZE_CLASS: Record<IconSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/** Emoji 略小于图标尺寸，补偿彩色字体比 SVG 更饱满的视觉面积。 */
export const ICON_EMOJI_CLASS: Record<IconSize, string> = {
  xs: 'text-[12px]',
  sm: 'text-[14px]',
  md: 'text-[18px]',
  lg: 'text-[22px]',
}
