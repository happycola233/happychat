import { describe, expect, it } from 'vitest'
import { beginBranchCreationCooldown, BRANCH_CREATION_COOLDOWN_MS } from './branchCreationGuard'

describe('branch creation cooldown', () => {
  it('blocks a second immediate click but expires for a later intentional branch', () => {
    const firstClickAt = Date.now() + BRANCH_CREATION_COOLDOWN_MS

    expect(beginBranchCreationCooldown(firstClickAt)).toBe(true)
    expect(beginBranchCreationCooldown(firstClickAt + 1)).toBe(false)
    expect(beginBranchCreationCooldown(firstClickAt + BRANCH_CREATION_COOLDOWN_MS)).toBe(true)
  })
})
