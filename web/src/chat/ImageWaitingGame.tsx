import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, RotateCcw } from 'lucide-react'
import {
  advanceSnake,
  createSnakeGame,
  pauseSnake,
  queueSnakeTurn,
  snakeDirectionForKey,
  type SnakeDirection,
  type SnakeGameState,
} from './snakeGame'
import { SnakeBoard, type SnakeBoardHandle } from './SnakeBoard'
import './snakeGame.css'

const DIRECTIONS = [
  { direction: 'left', label: '向左', Icon: ArrowLeft },
  { direction: 'up', label: '向上', Icon: ArrowUp },
  { direction: 'down', label: '向下', Icon: ArrowDown },
  { direction: 'right', label: '向右', Icon: ArrowRight },
] as const

export function ImageWaitingGame() {
  const [game, setGame] = useState(createSnakeGame)
  const motionRef = useRef(game)
  const drawingRef = useRef<SnakeBoardHandle>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const touchOrigin = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const instructionId = useId()
  const running = game.status === 'running'
  const ended = game.status === 'over' || game.status === 'won'

  const updateGame = useCallback((update: (state: SnakeGameState) => SnakeGameState) => {
    motionRef.current = update(motionRef.current)
    setGame(motionRef.current)
  }, [])
  const pause = useCallback(() => updateGame(pauseSnake), [updateGame])

  useLayoutEffect(() => {
    drawingRef.current!.draw(motionRef.current)
  }, [game])

  useEffect(() => {
    if (!running) return
    let previousTime = performance.now()
    let frame: number
    const animate = (time: number) => {
      const previous = motionRef.current
      // 浏览器卡顿后不补走一大段看不见的路；正常帧始终按真实经过时间匀速前进。
      const elapsed = Math.min(64, Math.max(0, time - previousTime))
      previousTime = time
      const next = advanceSnake(previous, elapsed, Math.random)
      motionRef.current = next
      drawingRef.current!.draw(next)
      if (next.body !== previous.body || next.status !== previous.status) setGame(next)
      if (next.status === 'running') frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [running])

  useEffect(() => {
    boardRef.current!.focus({ preventScroll: true })
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') pause()
    }
    // 滚出视口也暂停，避免用户查看聊天时在看不见的棋盘里输掉一局。
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry!.isIntersecting) pause()
    })
    observer.observe(boardRef.current!)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('blur', pause)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('blur', pause)
    }
  }, [pause])

  const play = () => {
    updateGame((state) => ({
      ...(state.status === 'over' || state.status === 'won' ? createSnakeGame() : state),
      status: 'running',
    }))
    boardRef.current?.focus({ preventScroll: true })
  }
  const turn = (direction: SnakeDirection) => {
    updateGame((state) => queueSnakeTurn(state, direction))
    boardRef.current?.focus({ preventScroll: true })
  }
  const statusText =
    game.status === 'won'
      ? '填满棋盘，通关了！'
      : game.status === 'over'
        ? '撞到自己了'
        : game.status === 'paused'
          ? '已暂停'
          : '给等待一点乐趣'
  const statusContent = (
    <div className="hc-snake-overlay-content">
      <p role="status" className="hc-snake-message">
        {statusText}
      </p>
      <p className="hc-snake-caption">
        {ended
          ? `本局 ${game.score} 分${game.status === 'over' ? ' · 红圈标出了相撞的位置' : ''}`
          : game.status === 'paused'
            ? '继续游戏，从这里出发'
            : '吃光点长大，避开自己的身体'}
      </p>
      <button type="button" onClick={play} className="hc-snake-play">
        {ended ? <RotateCcw size={14} /> : <Play size={14} fill="currentColor" />}
        {ended ? '再玩一次' : game.status === 'paused' ? '继续游戏' : '开始游戏'}
      </button>
    </div>
  )

  return (
    <section
      aria-label="等待时玩贪吃蛇"
      className="hc-snake-game hc-anim-in"
      data-state={game.status}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) pause()
      }}
    >
      <header className="hc-snake-header">
        <span className="hc-snake-title">贪吃蛇</span>
        <div className="hc-snake-toolbar">
          <output className="hc-snake-score" aria-label={`得分 ${game.score}`} aria-live="polite">
            <strong key={game.score}>{String(game.score).padStart(2, '0')}</strong>
            <span>分</span>
          </output>
          <button
            type="button"
            disabled={game.status === 'ready' || ended}
            aria-label={game.status === 'paused' ? '继续游戏' : '暂停游戏'}
            onClick={() => (running ? pause() : play())}
            className="hc-snake-icon-button"
          >
            {game.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
      </header>
      <div
        ref={boardRef}
        role="group"
        aria-label="贪吃蛇游戏区域"
        aria-describedby={instructionId}
        tabIndex={0}
        className="hc-snake-board"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          const direction = snakeDirectionForKey(event.key)
          if (direction && running) {
            event.preventDefault()
            if (event.repeat) return
            turn(direction)
          } else if (
            (event.key === ' ' || event.key === 'Enter') &&
            event.target === event.currentTarget
          ) {
            event.preventDefault()
            if (event.repeat) return
            if (running) pause()
            else play()
          } else if (event.key === 'Escape') {
            pause()
          }
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.pointerType === 'mouse' || !running) return
          touchOrigin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const origin = touchOrigin.current
          if (!origin || origin.pointerId !== event.pointerId) return
          const dx = event.clientX - origin.x
          const dy = event.clientY - origin.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return
          // 越过阈值立即记录转向，不必等手指离屏；同一次拖动可以连续改变方向。
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
          touchOrigin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
        }}
        onPointerUp={() => {
          touchOrigin.current = null
        }}
        onPointerCancel={() => {
          touchOrigin.current = null
        }}
        style={{ touchAction: running ? 'none' : 'pan-y' }}
      >
        <SnakeBoard ref={drawingRef} game={game} />
        {!running && !ended && <div className="hc-snake-overlay">{statusContent}</div>}
      </div>
      {ended && <div className="hc-snake-result">{statusContent}</div>}
      <footer className="hc-snake-footer">
        <div className="hc-snake-controls" aria-label="方向控制">
          {DIRECTIONS.map(({ direction, label, Icon }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!running}
              className="hc-snake-direction"
              data-direction={direction}
              onClick={() => turn(direction)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div id={instructionId} className="hc-snake-instructions">
          <span className="hc-snake-desktop-hint">方向键 / WASD 转向 · 空格暂停</span>
          <span className="hc-snake-touch-hint">滑动或轻点箭头转向</span>
          <span>可穿过边缘 · 撞到自己会结束</span>
        </div>
      </footer>
    </section>
  )
}
