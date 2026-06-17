import { useEffect, useState } from 'react'

import { elapsedSeconds } from './elapsed'

export function ElapsedLabel({
  prefix,
  startedAt,
  active,
}: {
  prefix: string
  startedAt: number | null
  active: boolean
}) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt))

  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt))
    if (!active) return undefined
    const timer = setInterval(() => {
      setSeconds(elapsedSeconds(startedAt))
    }, 200)
    return () => clearInterval(timer)
  }, [active, startedAt])

  return (
    <span>
      {prefix} {seconds}s
    </span>
  )
}
