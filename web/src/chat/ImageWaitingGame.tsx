import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, RotateCcw } from 'lucide-react'
import { clsx } from 'clsx'
import {
  createSnakeGame,
  pauseSnake,
  SNAKE_COLUMNS,
  SNAKE_ROWS,
  snakeDirectionForKey,
  stepSnake,
  turnSnake,
  type SnakeDirection,
} from './snakeGame'

const CONTROL_CLASS =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-500 transition hover:bg-black/5 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100'

export function ImageWaitingGame() {
  const [game, setGame] = useState(createSnakeGame)
  const boardRef = useRef<HTMLDivElement>(null)
  const touchOrigin = useRef<{ x: number; y: number } | null>(null)
  const instructionId = useId()
  const running = game.status === 'running'
  const ended = game.status === 'over' || game.status === 'won'

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      const random = Math.random()
      setGame((state) => stepSnake(state, random))
    }, 180)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    const pause = () => setGame(pauseSnake)
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') pause()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('blur', pause)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('blur', pause)
    }
  }, [])

  const play = () => {
    setGame((state) => ({ ...(ended ? createSnakeGame() : state), status: 'running' }))
    boardRef.current?.focus({ preventScroll: true })
  }
  const turn = (direction: SnakeDirection) => {
    setGame((state) => turnSnake(state, direction))
    boardRef.current?.focus({ preventScroll: true })
  }
  const statusText =
    game.status === 'won'
      ? '全部吃到了！'
      : game.status === 'over'
        ? '再来一局？'
        : game.status === 'paused'
          ? '已暂停'
          : '玩一局贪吃蛇'
  const directions = [
    { direction: 'left', label: '向左', Icon: ArrowLeft },
    { direction: 'up', label: '向上', Icon: ArrowUp },
    { direction: 'down', label: '向下', Icon: ArrowDown },
    { direction: 'right', label: '向右', Icon: ArrowRight },
  ] as const

  return (
    <section
      aria-label="等待时玩贪吃蛇"
      className="hc-anim-in mt-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setGame(pauseSnake)
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">图片仍在生成</span>
        <span
          aria-label={`得分 ${game.score}`}
          className="font-medium tabular-nums text-neutral-600 dark:text-neutral-300"
        >
          {game.score} 分
        </span>
      </div>
      <div
        ref={boardRef}
        role="group"
        aria-label="贪吃蛇游戏区域"
        aria-describedby={instructionId}
        tabIndex={0}
        className="hc-snake-board relative overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900"
        onKeyDown={(event) => {
          const direction = snakeDirectionForKey(event.key)
          if (direction && running) {
            event.preventDefault()
            turn(direction)
          } else if (event.key === ' ' && event.target === event.currentTarget) {
            event.preventDefault()
            if (running) setGame(pauseSnake)
            else play()
          } else if (event.key === 'Escape') {
            setGame(pauseSnake)
          }
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' || !running) return
          touchOrigin.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => {
          const origin = touchOrigin.current
          touchOrigin.current = null
          if (!origin) return
          const dx = event.clientX - origin.x
          const dy = event.clientY - origin.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
        }}
        onPointerCancel={() => {
          touchOrigin.current = null
        }}
        style={{ touchAction: running ? 'none' : 'pan-y' }}
      >
        <svg
          viewBox={`0 0 ${SNAKE_COLUMNS * 16} ${SNAKE_ROWS * 16}`}
          className={clsx('block w-full', !running && 'opacity-20')}
          aria-hidden="true"
        >
          {game.body.map((point, index) => (
            <rect
              key={`${point.x}-${point.y}`}
              x={point.x * 16 + 1.5}
              y={point.y * 16 + 1.5}
              width={13}
              height={13}
              rx={index === 0 ? 5 : 4}
              className="fill-emerald-600 dark:fill-emerald-400"
              opacity={Math.max(0.3, 1 - index * 0.045)}
            />
          ))}
          {game.food && (
            <circle
              cx={game.food.x * 16 + 8}
              cy={game.food.y * 16 + 8}
              r={4.5}
              className="fill-amber-500 dark:fill-amber-300"
            />
          )}
        </svg>
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
            <p
              role="status"
              className="text-[13px] font-medium text-neutral-600 dark:text-neutral-300"
            >
              {statusText}
            </p>
            <button
              type="button"
              onClick={play}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-neutral-800 px-4 text-xs font-medium text-white transition hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              {ended ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {ended ? '再玩一次' : game.status === 'paused' ? '继续' : '开始游戏'}
            </button>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5" aria-label="方向控制">
          {directions.map(({ direction, label, Icon }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!running}
              className={clsx(CONTROL_CLASS, 'disabled:opacity-30')}
              onClick={() => turn(direction)}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!running}
          aria-label="暂停游戏"
          onClick={() => setGame(pauseSnake)}
          className={clsx(CONTROL_CLASS, 'disabled:opacity-30')}
        >
          <Pause className="h-4 w-4" />
        </button>
      </div>
      <p
        id={instructionId}
        className="mt-0.5 text-[11px] leading-4 text-neutral-400 dark:text-neutral-500"
      >
        方向键或滑动转向 · 空格暂停 · 可穿过边缘
      </p>
    </section>
  )
}
