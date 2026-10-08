import { describe, expect, it } from 'vitest'
import { validateDeviceFilename, validateFilenames, validateBoolean, validateId } from '../jensen-validation'
describe('IPC validation', () => {
  it.each(['../file.hda', 'C:\\file.hda', 'folder/file.hda', 'file\0.hda', '', 'a'.repeat(256)])('rejects unsafe filename %s', value => expect(() => validateDeviceFilename(value)).toThrow())
  it('deduplicates a valid selection', () => expect(validateFilenames(['rec.hda', 'rec.hda'])).toEqual(['rec.hda']))
  it('refuses values outside the typed contract', () => { expect(() => validateBoolean('true')).toThrow(); expect(() => validateId('../../secret')).toThrow() })
})
