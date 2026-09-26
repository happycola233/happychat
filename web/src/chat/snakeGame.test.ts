import { describe, expect, it } from 'vitest'
import {
  createSnakeGame,
  pauseSnake,
  SNAKE_COLUMNS,
  SNAKE_ROWS,
  snakeDirectionForKey,
  stepSnake,
  queueSnakeTurn,
  advanceSnake,
  snakeSegmentMotion,
  SNAKE_STEP_MS,
  type SnakeGameState,
} from './snakeGame'

const runningGame = (): SnakeGameState => ({ ...createSnakeGame(), status: 'running' })

describe('waiting snake game', () => {
  it('does not move before play or while paused', () => {
    const ready = createSnakeGame()
    expect(stepSnake(ready, 0)).toBe(ready)
    const paused = pauseSnake(runningGame())
    expect(paused.status).toBe('paused')
    expect(stepSnake(paused, 0)).toBe(paused)
  })

  it('queues rapid turns without changing position, progress, or speed', () => {
    const game = advanceSnake(runningGame(), 90, () => 0)
    const queued = queueSnakeTurn(queueSnakeTurn(game, 'up'), 'left')
    expect(queued.body).toBe(game.body)
    expect(queued.progress).toBe(0.5)
    expect(queued.direction).toBe('right')
    expect(queued.turnQueue).toEqual(['up', 'left'])
    const corner = advanceSnake(queued, 90, () => 0)
    expect(corner.body[0]).toEqual({ x: 6, y: 5 })
    expect(corner.direction).toBe('up')
    const nextCorner = advanceSnake(corner, 180, () => 0)
    expect(nextCorner.body[0]).toEqual({ x: 6, y: 4 })
    expect(nextCorner.direction).toBe('left')
    expect(nextCorner.turnQueue).toEqual([])
  })

  it('ignores repeated/reverse directions, bounds the queue, and ignores paused input', () => {
    const game = runningGame()
    expect(queueSnakeTurn(game, 'left')).toBe(game)
    expect(queueSnakeTurn(game, 'right')).toBe(game)
    const upward = queueSnakeTurn(game, 'up')
    expect(queueSnakeTurn(upward, 'up')).toBe(upward)
    expect(queueSnakeTurn(upward, 'down')).toBe(upward)
    const full = queueSnakeTurn(upward, 'left')
    expect(queueSnakeTurn(full, 'down')).toBe(full)
    const paused = pauseSnake(upward)
    expect(queueSnakeTurn(paused, 'left')).toBe(paused)
  })

  it('moves at the same speed across a turn with no diagonal shortcut or extra tick of visual lag', () => {
    let game = queueSnakeTurn(runningGame(), 'up')
    const headPath = [
      { x: 5, y: 5 },
      { x: 5.25, y: 5 },
      { x: 5.5, y: 5 },
      { x: 5.75, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 4.75 },
      { x: 6, y: 4.5 },
    ]
    for (const point of headPath) {
      expect(snakeSegmentMotion(game, 0)).toMatchObject(point)
      game = advanceSnake(game, SNAKE_STEP_MS / 4, () => 0)
    }
    // 蛇身延后一格经过同一个拐点，而非直接连接两个位置切斜线。
    expect(snakeSegmentMotion(game, 1)).toMatchObject({ x: 5.75, y: 5 })
    game = advanceSnake(game, SNAKE_STEP_MS / 2, () => 0)
    expect(snakeSegmentMotion(game, 1)).toMatchObject({ x: 6, y: 4.75 })
  })

  it('preserves fractional position when pausing and resuming', () => {
    const moving = advanceSnake(runningGame(), 73, () => 0)
    const paused = pauseSnake(moving)
    expect(advanceSnake(paused, 5000, () => 0)).toBe(paused)
    expect(snakeSegmentMotion(paused, 0)).toEqual(snakeSegmentMotion(moving, 0))
    const resumed = advanceSnake({ ...paused, status: 'running' }, 107, () => 0)
    expect(resumed.body[0]).toEqual({ x: 6, y: 5 })
    expect(resumed.progress).toBeCloseTo(0)
  })

  it('keeps elapsed distance consistent at 30, 60, and 144 Hz', () => {
    for (const fps of [30, 60, 144]) {
      let game = queueSnakeTurn(queueSnakeTurn(runningGame(), 'up'), 'left')
      for (let frame = 0; frame < fps; frame++) game = advanceSnake(game, 1000 / fps, () => 0)
      const head = snakeSegmentMotion(game, 0)
      expect(head.x).toBeCloseTo(6 - (1000 / SNAKE_STEP_MS - 2))
      expect(head.y).toBe(4)
      expect(game.status).toBe('running')
    }
  })

  it('interpolates across the nearest edge with a matching wrapped copy', () => {
    for (const [direction, origin, expected] of [
      ['right', { x: 17, y: 5 }, { x: 17.5, y: 5, wrapX: 18, wrapY: 0 }],
      ['left', { x: 0, y: 5 }, { x: -0.5, y: 5, wrapX: -18, wrapY: 0 }],
      ['up', { x: 5, y: 0 }, { x: 5, y: -0.5, wrapX: 0, wrapY: -16 }],
      ['down', { x: 5, y: 15 }, { x: 5, y: 15.5, wrapX: 0, wrapY: 16 }],
    ] as const) {
      expect(
        snakeSegmentMotion({ ...runningGame(), body: [origin], direction, progress: 0.5 }, 0),
      ).toEqual(expected)
    }
  })

  it('wraps around all edges', () => {
    for (const [direction, origin, expected] of [
      ['left', { x: 0, y: 5 }, { x: SNAKE_COLUMNS - 1, y: 5 }],
      ['right', { x: SNAKE_COLUMNS - 1, y: 5 }, { x: 0, y: 5 }],
      ['up', { x: 5, y: 0 }, { x: 5, y: SNAKE_ROWS - 1 }],
      ['down', { x: 5, y: SNAKE_ROWS - 1 }, { x: 5, y: 0 }],
    ] as const) {
      const game = { ...runningGame(), body: [origin], direction }
      expect(stepSnake(game, 0).body[0]).toEqual(expected)
    }
  })

  it('grows on food and places the next food in a free cell', () => {
    const game = { ...runningGame(), food: { x: 6, y: 5 } }
    for (const random of [0, 0.4, 0.9999]) {
      const next = stepSnake(game, random)
      expect(next.score).toBe(1)
      expect(next.body).toHaveLength(game.body.length + 1)
      expect(next.eatenFood).toEqual(game.food)
      expect(next.body).not.toContainEqual(next.food)
    }
  })

  it('allows entering the cell the tail vacates but stops at the body', () => {
    const game: SnakeGameState = {
      ...runningGame(),
      body: [
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 4 },
      ],
    }
    expect(stepSnake(game, 0).status).toBe('running')
    expect(stepSnake({ ...game, body: [...game.body, { x: 6, y: 4 }] }, 0).status).toBe('over')
  })

  it('ends with a win when the last free cell is filled', () => {
    const lastFood = { x: 1, y: 0 }
    const body = Array.from({ length: SNAKE_COLUMNS * SNAKE_ROWS }, (_, cell) => ({
      x: cell % SNAKE_COLUMNS,
      y: Math.floor(cell / SNAKE_COLUMNS),
    })).filter((point) => point.x !== lastFood.x || point.y !== lastFood.y)
    const won = stepSnake({ ...runningGame(), body, food: lastFood }, 0)
    expect(won.status).toBe('won')
    expect(won.food).toBeNull()
    expect(won.body).toHaveLength(SNAKE_COLUMNS * SNAKE_ROWS)
  })

  it('keeps the actual collision position and heading in the final frame', () => {
    const game: SnakeGameState = {
      ...runningGame(),
      direction: 'up',
      body: [
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
      ],
    }
    const ended = stepSnake({ ...game, direction: 'right' }, 0)
    expect(ended.status).toBe('over')
    expect(ended.direction).toBe('right')
    expect(ended.body[0]).toEqual({ x: 5, y: 4 })
    expect(ended.body.slice(1)).toContainEqual(ended.body[0])
    expect(ended.body).toHaveLength(game.body.length)
    expect(ended.score).toBe(game.score)
    expect(stepSnake(ended, 0)).toBe(ended)
  })

  it('marks a self-collision on the opposite edge after wrapping', () => {
    const game: SnakeGameState = {
      ...runningGame(),
      direction: 'up',
      body: [
        { x: 0, y: 5 },
        { x: 0, y: 6 },
        { x: 17, y: 6 },
        { x: 17, y: 5 },
        { x: 16, y: 5 },
      ],
    }
    const ended = stepSnake({ ...game, direction: 'left' }, 0)
    expect(ended.status).toBe('over')
    expect(ended.body[0]).toEqual({ x: SNAKE_COLUMNS - 1, y: 5 })
    expect(ended.direction).toBe('left')
  })

  it('maps arrows and case-insensitive WASD within the focused game', () => {
    expect(snakeDirectionForKey('ArrowUp')).toBe('up')
    expect(snakeDirectionForKey('w')).toBe('up')
    expect(snakeDirectionForKey('A')).toBe('left')
    expect(snakeDirectionForKey('s')).toBe('down')
    expect(snakeDirectionForKey('D')).toBe('right')
    expect(snakeDirectionForKey('Enter')).toBeNull()
  })
})
