import { describe, expect, it } from 'vitest'
import { whisperPreparationError } from '../ai/whisper-model-cache'
import { ProcessingError } from '../ai/errors'
describe('local Whisper setup diagnostics', () => {
  it('preserves verified download failures and retry policy', () => { const error = new ProcessingError('Download failed verification.', true); expect(whisperPreparationError(error)).toBe(error) })
  it.each(['EACCES', 'EPERM', 'EROFS'])('explains model dataset permissions for %s', code => { expect(whisperPreparationError({ code, message: 'secret path' }).message).toContain('write access'); expect(whisperPreparationError({ code }).retryable).toBe(false) })
  it.each(['ENOSPC', 'EDQUOT'])('explains insufficient space for %s', code => { expect(whisperPreparationError({ code }).message).toContain('disk space') })
  it('identifies the missing bzip2 runtime without leaking subprocess output', () => { const error = whisperPreparationError({ code: 2, stderr: 'bzip2: Cannot exec: No such file or directory secret' }); expect(error.message).toContain('tar/bzip2'); expect(error.message).not.toContain('secret') })
  it('identifies an absent archive executable', () => { expect(whisperPreparationError({ code: 'ENOENT' }).message).toContain('archive tool') })
  it('redacts unexpected errors while retaining a retryable setup explanation', () => { const error = whisperPreparationError(new Error('https://example.test?token=secret')); expect(error.message).toContain('local Whisper model'); expect(error.message).not.toContain('secret'); expect(error.retryable).toBe(true) })
})
