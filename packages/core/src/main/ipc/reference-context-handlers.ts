import { readReferenceContext, saveReferenceContext } from '../services/reference-context'
import { validateId } from './jensen-validation'
import { handle } from './trusted-ipc'

export function registerReferenceContextHandlers(changed: () => void): void {
  handle('reference-context:get', project => readReferenceContext(project === null ? null : validateId(project)))
  handle('reference-context:save', (project, content, version) => {
    const saved = saveReferenceContext(project === null ? null : validateId(project), content, version)
    changed()
    return saved
  })
}
