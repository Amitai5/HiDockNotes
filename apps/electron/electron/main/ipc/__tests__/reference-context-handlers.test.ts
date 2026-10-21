import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerReferenceContextHandlers } from '../reference-context-handlers'
import { closeDatabase, createProject, initializeDatabase } from '../../services/database'
import { EMPTY_REFERENCE_CONTEXT } from '../../../../src/shared/reference-context'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('../trusted-ipc', () => ({ handle: (name: string, callback: (...args: unknown[]) => unknown) => handlers.set(name, callback) }))

describe('reference context IPC boundary', () => {
  const changed = vi.fn()
  beforeEach(() => { initializeDatabase(':memory:'); handlers.clear(); changed.mockClear(); registerReferenceContextHandlers(changed) })
  afterEach(closeDatabase)
  it('allows explicit global and existing project scopes and publishes successful saves', () => {
    const project = createProject('Project')
    const global = handlers.get('reference-context:save')!(null, { ...EMPTY_REFERENCE_CONTEXT, background: 'Shared context' }, 0)
    expect(global).toMatchObject({ version: 1, content: { background: 'Shared context' } })
    expect(handlers.get('reference-context:get')!(project.id)).toMatchObject({ version: 0 })
    expect(changed).toHaveBeenCalledOnce()
  })
  it.each([undefined, '', '../project', 1, {}, false])('rejects an ambiguous or invalid scope %j', scope => {
    expect(() => handlers.get('reference-context:get')!(scope)).toThrow()
    expect(() => handlers.get('reference-context:save')!(scope, EMPTY_REFERENCE_CONTEXT, 0)).toThrow()
    expect(changed).not.toHaveBeenCalled()
  })
  it('does not emit a change when validation or a stale save fails', () => {
    handlers.get('reference-context:save')!(null, EMPTY_REFERENCE_CONTEXT, 0)
    changed.mockClear()
    expect(() => handlers.get('reference-context:save')!(null, EMPTY_REFERENCE_CONTEXT, 0)).toThrow('another window')
    expect(() => handlers.get('reference-context:save')!(null, [], 1)).toThrow()
    expect(changed).not.toHaveBeenCalled()
  })
})
