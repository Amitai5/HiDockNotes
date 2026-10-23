import type { SemanticSearch } from '../search/semantic-search'
import { handle } from './trusted-ipc'
import { validateBoolean, validateText } from './jensen-validation'

export function registerSemanticHandlers(service: SemanticSearch): void {
  handle('semantic:state', () => service.state())
  handle('semantic:enable', () => service.enable())
  handle('semantic:disable', () => service.disable())
  handle('semantic:dismiss-setup', () => service.dismissSetup())
  handle('semantic:remove-model', confirmed => { if (!validateBoolean(confirmed)) throw new Error('Confirm before removing the search model.'); return service.removeModel() })
  handle('semantic:search', (query, status, mode) => {
    if (mode !== undefined && mode !== 'meaning' && mode !== 'keywords') throw new Error('Choose keywords or meaning search.')
    return service.search(validateText(query, 500), status === undefined ? '' : validateText(status, 40), mode)
  })
}
