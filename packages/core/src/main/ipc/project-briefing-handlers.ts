import type { ProjectBriefings } from '../ai/project-briefing'
import { validateId } from './jensen-validation'
import { handle } from './trusted-ipc'

export function registerProjectBriefingHandlers(service: ProjectBriefings): void {
  handle('project-briefing:get', (project, options) => service.get(validateId(project), options))
  handle('project-briefing:generate', (project, options) => service.generate(validateId(project), options))
  handle('project-briefing:cancel', project => service.cancel(validateId(project)))
}
