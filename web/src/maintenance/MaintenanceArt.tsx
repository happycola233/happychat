/** 线条按书写顺序依次描出；d 之外的属性全部由 `.hc-maint-art-*` 提供。 */
const ART_LINES = [
  // 花盆口沿
  'M52 93 C70 90 96 90 112 93 C113 97 112 101 111 104 C94 102 70 102 53 104 C52 100 51 97 52 93 Z',
  // 花盆
  'M57 104 C58 117 61 129 65 138 C76 141 90 141 99 138 C103 129 106 117 107 104',
  // 茎
  'M82 90 C81 78 84 66 82 51',
  // 左叶
  'M82 73 C68 73 58 65 54 51 C68 49 79 59 82 73 Z',
  // 右叶
  'M82 61 C84 47 94 37 108 35 C108 49 98 59 82 61 Z',
  // 星芒
  'M128 44 C129 50 130 51 136 52 C130 53 129 54 128 60 C127 54 126 53 120 52 C126 51 127 50 128 44 Z',
  // 两笔点缀
  'M36 70 L42 68',
  'M124 82 L130 85',
]

/**
 * 维护页插画：一盆刚冒头的新芽。
 * 同一份路径也内联在 web/public/maintenance.html 里，改动时请一并更新。
 */
export function MaintenanceArt({ className }: { className?: string }) {
  return (
    <svg viewBox="20 16 132 132" className={`hc-maint-art ${className ?? ''}`} aria-hidden>
      <path
        className="hc-maint-art-wash"
        d="M38 80 C30 50 58 24 92 28 C126 32 146 60 136 94 C128 122 96 136 66 126 C48 120 42 102 38 80 Z"
      />
      {ART_LINES.map((d, index) => (
        <path
          key={d}
          className="hc-maint-art-line"
          pathLength={1}
          d={d}
          style={{ animationDelay: `${0.15 + index * 0.16}s` }}
        />
      ))}
    </svg>
  )
}
