export const SNAKE_COLUMNS = 18
export const SNAKE_ROWS = 10

export type SnakeDirection = 'up' | 'right' | 'down' | 'left'
export type SnakePoint = { x: number; y: number }
export interface SnakeGameState {
  body: SnakePoint[]
  direction: SnakeDirection
  nextDirection: SnakeDirection
  food: SnakePoint | null
  score: number
  status: 'ready' | 'running' | 'paused' | 'over' | 'won'
}

const MOVEMENT: Record<SnakeDirection, SnakePoint> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

export function createSnakeGame(): SnakeGameState {
  return {
    body: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    direction: 'right',
    nextDirection: 'right',
    food: { x: 12, y: 5 },
    score: 0,
    status: 'ready',
  }
}

export function turnSnake(state: SnakeGameState, direction: SnakeDirection): SnakeGameState {
  if (state.status !== 'running' || state.nextDirection !== state.direction) return state
  const current = MOVEMENT[state.direction]
  const next = MOVEMENT[direction]
  // 一次移动最多接受一个转向，避免快速连续按键在同一帧内造成掉头。
  if (current.x + next.x === 0 && current.y + next.y === 0) return state
  return { ...state, nextDirection: direction }
}

export function pauseSnake(state: SnakeGameState): SnakeGameState {
  return state.status === 'running' ? { ...state, status: 'paused' } : state
}

export function stepSnake(state: SnakeGameState, random: number): SnakeGameState {
  if (state.status !== 'running') return state
  const head = state.body[0]!
  const movement = MOVEMENT[state.nextDirection]
  // 穿过边缘会从另一侧出现；等待时玩的小互动不增加撞墙压力。
  const nextHead = {
    x: (head.x + movement.x + SNAKE_COLUMNS) % SNAKE_COLUMNS,
    y: (head.y + movement.y + SNAKE_ROWS) % SNAKE_ROWS,
  }
  const eating = state.food?.x === nextHead.x && state.food.y === nextHead.y
  const remainingBody = eating ? state.body : state.body.slice(0, -1)
  if (remainingBody.some((point) => point.x === nextHead.x && point.y === nextHead.y)) {
    return { ...state, status: 'over' }
  }
  const body = [nextHead, ...remainingBody]
  let food = state.food
  if (eating) {
    const occupied = new Set(body.map((point) => point.y * SNAKE_COLUMNS + point.x))
    const freeCells = Array.from({ length: SNAKE_COLUMNS * SNAKE_ROWS }, (_, i) => i).filter(
      (cell) => !occupied.has(cell),
    )
    const foodCell = freeCells[Math.floor(random * freeCells.length)]
    food =
      foodCell === undefined
        ? null
        : { x: foodCell % SNAKE_COLUMNS, y: Math.floor(foodCell / SNAKE_COLUMNS) }
  }
  return {
    ...state,
    body,
    food,
    direction: state.nextDirection,
    score: state.score + Number(eating),
    status: food ? 'running' : 'won',
  }
}

export function snakeDirectionForKey(key: string): SnakeDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowRight':
      return 'right'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    default:
      return null
  }
}
