import { describe, expect, it } from 'vitest'
import {
  createSnakeGame,
  pauseSnake,
  SNAKE_COLUMNS,
  SNAKE_ROWS,
  snakeDirectionForKey,
  stepSnake,
  turnSnake,
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

  it('rejects reversal and only accepts one turn in each movement step', () => {
    const game = runningGame()
    expect(turnSnake(game, 'left')).toBe(game)
    const upward = turnSnake(game, 'up')
    expect(turnSnake(upward, 'left')).toBe(upward)
    const moved = stepSnake(upward, 0)
    expect(moved.body[0]).toEqual({ x: 5, y: 4 })
    expect(turnSnake(moved, 'left').nextDirection).toBe('left')
  })

  it('wraps around all edges', () => {
    for (const [direction, origin, expected] of [
      ['left', { x: 0, y: 5 }, { x: SNAKE_COLUMNS - 1, y: 5 }],
      ['right', { x: SNAKE_COLUMNS - 1, y: 5 }, { x: 0, y: 5 }],
      ['up', { x: 5, y: 0 }, { x: 5, y: SNAKE_ROWS - 1 }],
      ['down', { x: 5, y: SNAKE_ROWS - 1 }, { x: 5, y: 0 }],
    ] as const) {
      const game = { ...runningGame(), body: [origin], direction, nextDirection: direction }
      expect(stepSnake(game, 0).body[0]).toEqual(expected)
    }
  })

  it('grows on food and places the next food in a free cell', () => {
    const game = { ...runningGame(), food: { x: 6, y: 5 } }
    for (const random of [0, 0.4, 0.9999]) {
      const next = stepSnake(game, random)
      expect(next.score).toBe(1)
      expect(next.body).toHaveLength(4)
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

  it('only maps direction keys and leaves typing shortcuts untouched', () => {
    expect(snakeDirectionForKey('ArrowUp')).toBe('up')
    expect(snakeDirectionForKey('w')).toBeNull()
    expect(snakeDirectionForKey('Enter')).toBeNull()
  })
})
