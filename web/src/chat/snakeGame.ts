export const SNAKE_COLUMNS = 18
export const SNAKE_ROWS = 16
export const SNAKE_STEP_MS = 180

export type SnakeDirection = 'up' | 'right' | 'down' | 'left'
export type SnakePoint = { x: number; y: number }
export interface SnakeGameState {
  body: SnakePoint[]
  direction: SnakeDirection
  turnQueue: SnakeDirection[]
  progress: number
  food: SnakePoint | null
  eatenFood: SnakePoint | null
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
      { x: 2, y: 5 },
      { x: 2, y: 4 },
    ],
    direction: 'right',
    turnQueue: [],
    progress: 0,
    food: { x: 12, y: 5 },
    eatenFood: null,
    score: 0,
    status: 'ready',
  }
}

export function queueSnakeTurn(state: SnakeGameState, direction: SnakeDirection): SnakeGameState {
  const queuedDirection = state.turnQueue.at(-1) ?? state.direction
  if (state.status !== 'running' || direction === queuedDirection || state.turnQueue.length === 2) {
    return state
  }
  const current = MOVEMENT[queuedDirection]
  const next = MOVEMENT[direction]
  if (current.x + next.x === 0 && current.y + next.y === 0) return state
  // 最多预存两个拐弯，不移动蛇，也不重置时钟；避免快速按键丢失或积压很久后才执行。
  return { ...state, turnQueue: [...state.turnQueue, direction] }
}

export function snakeNextHead(state: SnakeGameState): SnakePoint {
  const head = state.body[0]!
  const movement = MOVEMENT[state.direction]
  return {
    x: (head.x + movement.x + SNAKE_COLUMNS) % SNAKE_COLUMNS,
    y: (head.y + movement.y + SNAKE_ROWS) % SNAKE_ROWS,
  }
}

export function snakeWillEat(state: SnakeGameState): boolean {
  const nextHead = snakeNextHead(state)
  return state.food?.x === nextHead.x && state.food.y === nextHead.y
}

/** 插值朝向下一格，画面与模拟共用进度，不再把画面延迟一个完整步长。 */
export function snakeSegmentMotion(state: SnakeGameState, index: number) {
  const from = state.body[index] ?? state.body.at(-1)!
  const to = index === 0 ? snakeNextHead(state) : (state.body[index - 1] ?? from)
  const wrapX = Math.abs(to.x - from.x) > 1 ? Math.sign(from.x - to.x) * SNAKE_COLUMNS : 0
  const wrapY = Math.abs(to.y - from.y) > 1 ? Math.sign(from.y - to.y) * SNAKE_ROWS : 0
  return {
    x: from.x + (to.x + wrapX - from.x) * state.progress,
    y: from.y + (to.y + wrapY - from.y) * state.progress,
    wrapX,
    wrapY,
  }
}

export function advanceSnake(
  state: SnakeGameState,
  elapsedMs: number,
  random: () => number,
): SnakeGameState {
  if (state.status !== 'running') return state
  let progress = state.progress + elapsedMs / SNAKE_STEP_MS
  let next = state
  while (progress >= 1) {
    next = stepSnake(next, random())
    progress -= 1
    if (next.status !== 'running') return next
  }
  return { ...next, progress }
}

export function pauseSnake(state: SnakeGameState): SnakeGameState {
  return state.status === 'running' ? { ...state, status: 'paused' } : state
}

export function stepSnake(state: SnakeGameState, random: number): SnakeGameState {
  if (state.status !== 'running') return state
  // 穿过边缘会从另一侧出现；等待时玩的小互动不增加撞墙压力。
  const nextHead = snakeNextHead(state)
  const eating = snakeWillEat(state)
  const remainingBody = eating ? state.body : state.body.slice(0, -1)
  if (remainingBody.some((point) => point.x === nextHead.x && point.y === nextHead.y)) {
    // 留下实际相撞的这一帧；停在上一格会让画面看起来根本没有碰到身体。
    return {
      ...state,
      body: [nextHead, ...remainingBody],
      progress: 0,
      turnQueue: [],
      status: 'over',
    }
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
    // 抵达格点才消费一个方向；整段移动中方向不变，蛇身逐节经过同一个拐点。
    direction: state.turnQueue[0] ?? state.direction,
    turnQueue: state.turnQueue.slice(1),
    progress: 0,
    food,
    eatenFood: eating ? state.food : state.eatenFood,
    score: state.score + Number(eating),
    status: food ? 'running' : 'won',
  }
}

export function snakeDirectionForKey(key: string): SnakeDirection | null {
  switch (key.toLowerCase()) {
    case 'arrowup':
    case 'w':
      return 'up'
    case 'arrowright':
    case 'd':
      return 'right'
    case 'arrowdown':
    case 's':
      return 'down'
    case 'arrowleft':
    case 'a':
      return 'left'
    default:
      return null
  }
}
