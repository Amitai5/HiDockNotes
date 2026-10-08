export class ProcessingError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); this.name = 'ProcessingError' }
}
export function providerError(error: unknown): ProcessingError {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
  if (status === 401 || status === 403) return new ProcessingError('The provider rejected this key. Verify the API key and its permissions in Settings.')
  if (status === 429) return new ProcessingError('The provider rate limit or quota was reached. Check billing or wait before retrying.', true)
  if (status === 404) return new ProcessingError('This model is unavailable for your account. Refresh models and choose another model in Settings.')
  if (status === 400 || status === 422) return new ProcessingError('The provider rejected the audio or model settings. Choose a timestamp-capable transcription model and check the language setting.')
  return new ProcessingError('The provider request could not complete. Check your connection and provider availability.', true)
}
export function safeProcessingError(error: unknown): ProcessingError {
  // SDK errors can include request URLs and credentials. Never persist or log them.
  return error instanceof ProcessingError ? error : new ProcessingError('Processing could not complete. Check that the audio and local models are available, then retry.')
}
