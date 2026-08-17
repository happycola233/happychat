import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { userDisplayInitial } from './userDisplayInitial'

/**
 * 管理端用户头像：优先用上传图，加载失败或未上传时回退姓名首字母。
 * 缓存破坏参数已包含在 `avatarUrl` 里，这里不再另拼版本。
 */
export function AdminUserAvatar({
  username,
  displayName,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  username: string
  displayName: string | null
  avatarUrl: string | null
  className?: string
  fallbackClassName?: string
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)

  useEffect(() => {
    setImageLoadFailed(false)
  }, [avatarUrl])

  if (avatarUrl && !imageLoadFailed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setImageLoadFailed(true)}
        className={clsx(
          // 上传头像可能带透明通道，需要实色衬底。
          'shrink-0 rounded-full bg-neutral-100 object-cover dark:bg-neutral-800',
          className,
        )}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        fallbackClassName,
        className,
      )}
    >
      {userDisplayInitial(username, displayName)}
    </span>
  )
}
