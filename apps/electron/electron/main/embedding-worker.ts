import type { FeatureExtractionPipeline } from '@huggingface/transformers'

let directory = '', extractor: FeatureExtractionPipeline | null = null, chain = Promise.resolve()
process.parentPort.on('message', (event: { data: { type: 'initialize'; directory: string } | { type: 'embed'; id: string; texts: string[] } }) => {
  const message = event.data
  if (message.type === 'initialize') { directory = message.directory; return }
  chain = chain.then(async () => {
    try {
      if (!directory || !Array.isArray(message.texts) || message.texts.length > 16 || message.texts.some(text => typeof text !== 'string' || text.length > 12000)) throw new Error('Invalid local search request.')
      if (!extractor) {
        const { pipeline, env } = await import('@huggingface/transformers')
        env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false
        extractor = await pipeline('feature-extraction', directory, { local_files_only: true, dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
      }
      const result = await extractor(message.texts, { pooling: 'mean', normalize: true })
      process.parentPort.postMessage({ id: message.id, vectors: result.tolist() })
    } catch { process.parentPort.postMessage({ id: message.id, error: 'The local search model could not run. Retry setup in Settings → AI & transcription.' }) }
  })
})
