import { useId, useImperativeHandle, useRef, type Ref } from 'react'
import {
  SNAKE_COLUMNS,
  SNAKE_ROWS,
  snakeSegmentMotion,
  snakeWillEat,
  type SnakeGameState,
} from './snakeGame'

const CELL_SIZE = 20
const HEAD_ROTATION = { right: 0, down: 90, left: 180, up: -90 }

export interface SnakeBoardHandle {
  draw: (state: SnakeGameState) => void
}

/** 逐帧只更新 SVG 坐标；格点、得分和状态改变时才交给 React 更新结构。 */
export function SnakeBoard({ game, ref }: { game: SnakeGameState; ref: Ref<SnakeBoardHandle> }) {
  const patternId = useId()
  const segmentsRef = useRef<(SVGGElement | null)[]>([])
  useImperativeHandle(
    ref,
    () => ({
      draw(state) {
        segmentsRef.current.forEach((node, index) => {
          if (!node) return
          const point = snakeSegmentMotion(state, index)
          node.setAttribute('transform', `translate(${point.x * CELL_SIZE} ${point.y * CELL_SIZE})`)
        })
      },
    }),
    [],
  )
  // 生长时新尾节留在原位，前一节逐渐离开，避免吃到食物的瞬间凭空跳出一节。
  const visibleBody =
    (game.status === 'running' || game.status === 'paused') && snakeWillEat(game)
      ? [...game.body, game.body.at(-1)!]
      : game.body

  return (
    <svg
      viewBox={`0 0 ${SNAKE_COLUMNS * CELL_SIZE} ${SNAKE_ROWS * CELL_SIZE}`}
      className="hc-snake-field"
      aria-hidden="true"
    >
      <defs>
        <pattern id={patternId} width={CELL_SIZE} height={CELL_SIZE} patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.1" className="hc-snake-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      <g className="hc-snake-pieces">
        {game.food && (
          <g
            transform={`translate(${game.food.x * CELL_SIZE + 10} ${game.food.y * CELL_SIZE + 10})`}
          >
            <circle r="11" className="hc-snake-food-halo" />
            <circle r="5.5" className="hc-snake-food" />
            <circle cx="-1.5" cy="-1.5" r="1.5" className="hc-snake-food-shine" />
          </g>
        )}
        {/* 尾巴先画，让转弯时的蛇头始终位于最上层。索引对应移动中的身体节段。 */}
        {visibleBody
          .map((_point, index) => {
            const head = index === 0
            const taper = 1 - index / visibleBody.length
            const point = snakeSegmentMotion(game, index)
            const segmentId = `${patternId}-segment-${index}`
            return (
              <g key={index}>
                <g
                  id={segmentId}
                  ref={(node) => {
                    segmentsRef.current[index] = node
                  }}
                  transform={`translate(${point.x * CELL_SIZE} ${point.y * CELL_SIZE})`}
                >
                  <circle
                    cx="10"
                    cy="10"
                    r={head ? 8.5 : 4 + taper * 3.5}
                    className="hc-snake-segment"
                    data-collision={head && game.status === 'over' ? '' : undefined}
                    opacity={head ? 1 : 0.4 + taper * 0.6}
                  />
                  {head && (
                    <g transform={`rotate(${HEAD_ROTATION[game.direction]} 10 10)`}>
                      <ellipse cx="12.5" cy="6.5" rx="2.5" ry="2.7" fill="white" />
                      <ellipse cx="12.5" cy="13.5" rx="2.5" ry="2.7" fill="white" />
                      <circle cx="13.4" cy="6.5" r="1.2" fill="#25365d" />
                      <circle cx="13.4" cy="13.5" r="1.2" fill="#25365d" />
                    </g>
                  )}
                </g>
                {point.wrapX !== 0 && <use href={`#${segmentId}`} x={-point.wrapX * CELL_SIZE} />}
                {point.wrapY !== 0 && <use href={`#${segmentId}`} y={-point.wrapY * CELL_SIZE} />}
              </g>
            )
          })
          .reverse()}
      </g>
      {game.status === 'over' && (
        <circle
          cx={game.body[0]!.x * CELL_SIZE + 10}
          cy={game.body[0]!.y * CELL_SIZE + 10}
          r="12"
          className="hc-snake-collision"
        />
      )}
      {game.eatenFood && (
        <g
          transform={`translate(${game.eatenFood.x * CELL_SIZE + 10} ${game.eatenFood.y * CELL_SIZE + 10})`}
        >
          <g key={game.score} className="hc-snake-bite">
            <circle r="12" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <text y="-16" textAnchor="middle" fontSize="10" fontWeight="600" fill="currentColor">
              +1
            </text>
          </g>
        </g>
      )}
    </svg>
  )
}
