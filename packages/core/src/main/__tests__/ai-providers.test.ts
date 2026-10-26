import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type { GoogleGenAI } from '@google/genai'
import { OpenAIProvider } from '../ai/openai-provider'
import { GeminiProvider } from '../ai/gemini-provider'
import { parseGeminiTranscript, parseOpenAITranscript, parseSummary } from '../ai/provider-parsing'
import { providerError } from '../ai/errors'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import { summaryInstructions, SUMMARY_SCHEMA } from '../ai/providers'

vi.mock('node:fs', async () => { const { Readable } = await import('node:stream'); return { ...(await vi.importActual<typeof import('node:fs')>('node:fs')), createReadStream: vi.fn(() => Readable.from(Buffer.from('synthetic audio'))) } })

describe('provider timestamp contracts', () => {
  it('keeps generated recording titles to six words and sixty characters', () => {
    const parseTitle = (title: string) => parseSummary(JSON.stringify({ title, summary: 'Saved summary.', actionItems: [] }), 5).title
    expect(parseTitle('HubSpot Intake Workflow and Form Design Review')).toBe('HubSpot Intake Workflow and Form Design')
    expect(parseTitle('  Client   intake  ')).toBe('Client intake')
    expect(parseTitle('A'.repeat(70))).toHaveLength(60)
    expect(Array.from(parseTitle('🎙'.repeat(70)))).toHaveLength(60)
    expect(parseTitle('Internationalization Internationalization Internationalization')).toBe('Internationalization Internationalization')
    expect(summaryInstructions(DEFAULT_AI_SETTINGS)).toContain('3–6 word topic name, at most 60 characters')
  })
  it('reads Gemini word_info annotations from multiple interaction steps', () => {
    const result = parseGeminiTranscript({ steps: [{ content: [{ annotations: [{ type: 'word_info', text: 'Hello', start_offset: '0.1s', end_offset: '0.45s' }] }] }, { content: [{ annotations: [{ type: 'word_info', text: 'Dana.', start_offset: '0.5s', end_offset: '0.9s' }] }] }] }, 2)
    expect(result.words).toEqual([{ start: 0.1, end: 0.45, text: 'Hello' }, { start: 0.5, end: 0.9, text: 'Dana.' }])
    expect(() => parseGeminiTranscript({ output_text: 'No timestamps' }, 2)).toThrow('timestamps')
  })
  it('reads both OpenAI verbose and diarized JSON and rejects fabricated timing', () => {
    expect(parseOpenAITranscript({ text: 'Hello', words: [{ word: 'Hello', start: 0, end: 1 }] }, 2).words).toHaveLength(1)
    expect(parseOpenAITranscript({ text: 'Hello', segments: [{ text: 'Hello', start: 0, end: 1, speaker: 'A' }] }, 2).segments).toHaveLength(1)
    expect(() => parseOpenAITranscript({ text: 'Hello' }, 2)).toThrow('timestamped')
    expect(() => parseOpenAITranscript({ segments: [{ text: 'Hello', start: -1, end: 9 }] }, 2)).toThrow()
  })
  it('validates summary structure and action evidence timestamps', () => {
    expect(parseSummary(JSON.stringify({ title: 'Plan', summary: 'Dana will send the plan.', actionItems: [{ text: 'Send the plan', start: 1 }] }), 2).actionItems[0].start).toBe(1)
    expect(() => parseSummary(JSON.stringify({ title: 'Plan', summary: 'Summary', actionItems: [{ text: 'Invented moment', start: 90 }] }), 2)).toThrow('timestamp')
    expect(() => parseSummary('not json', 2)).toThrow('incomplete')
  })
  it('does not expose SDK errors, URLs or keys', () => {
    const error = providerError({ status: 429, message: 'URL https://host?key=AQ.private-secret' })
    expect(error.message).not.toContain('AQ.')
    expect(error.retryable).toBe(true)
    expect(providerError({ status: 401 }).retryable).toBe(false)
  })
  it('accepts explicit deadlines, preserves missing legacy deadlines, and rejects impossible dates', () => {
    const summary = (dueDate: unknown) => JSON.stringify({ title: 'Plan', summary: 'A plan.', actionItems: [{ text: 'Send plan', start: 1, dueDate }] })
    expect(parseSummary(summary('2026-10-12'), 2).actionItems[0].dueDate).toBe('2026-10-12')
    expect(parseSummary(summary(null), 2).actionItems[0].dueDate).toBeNull()
    expect(() => parseSummary(summary('2026-02-30'), 2)).toThrow('due date')
    expect(() => parseSummary(summary('tomorrow'), 2)).toThrow('due date')
    expect(SUMMARY_SCHEMA.properties.actionItems.items.required).toContain('dueDate')
    expect(summaryInstructions(DEFAULT_AI_SETTINGS, { recordedAt: '2026-10-08T12:00:00Z' })).toContain('2026-10-08')
    expect(summaryInstructions(DEFAULT_AI_SETTINGS)).toContain('Do not resolve relative or incomplete dates')
  })
  it('requests Whisper word timing and explicit diarized segment timing', async () => {
    const create = vi.fn().mockResolvedValue({ text: 'Hello', words: [{ word: 'Hello', start: 0, end: 1 }], segments: [{ text: 'Hello', start: 0, end: 1 }] })
    const provider = new OpenAIProvider('fake', { audio: { transcriptions: { create } } } as unknown as OpenAI)
    await provider.transcribe('whisper-1', { path: 'unused.wav', duration: 2, language: 'en-US' })
    expect(create.mock.calls[0][0]).toMatchObject({ response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'], language: 'en' })
    await provider.transcribe('gpt-4o-transcribe-diarize', { path: 'unused.wav', duration: 2, language: 'auto' })
    expect(create.mock.calls[1][0]).toMatchObject({ response_format: 'diarized_json', chunking_strategy: 'auto' })
  })
  it('uses Gemini native interactions and always removes uploaded audio', async () => {
    const upload = vi.fn().mockResolvedValue({ name: 'files/test', uri: 'https://provider/files/test', state: 'ACTIVE' })
    const remove = vi.fn().mockResolvedValue({})
    const create = vi.fn().mockResolvedValue({ steps: [{ content: [{ annotations: [{ type: 'word_info', text: 'Hello', start_offset: '0s', end_offset: '1s' }] }] }] })
    const provider = new GeminiProvider('AQ.fake', { files: { upload, delete: remove }, interactions: { create } } as unknown as GoogleGenAI)
    await provider.transcribe('gemini-3.5-transcribe', { path: 'unused.wav', duration: 2, language: 'auto' })
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.5-transcribe', store: false, generation_config: { transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } } } })
    expect(remove).toHaveBeenCalledWith({ name: 'files/test' })
    create.mockRejectedValueOnce({ status: 403, message: 'AQ.secret' })
    await expect(provider.transcribe('gemini-3.5-transcribe', { path: 'unused.wav', duration: 2, language: 'auto' })).rejects.toThrow('rejected this key')
    expect(remove).toHaveBeenCalledTimes(2)
  })
  it('keeps provider summaries structured and disables stored OpenAI responses', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify({ title: 'Plan', meetingType: 'Planning', participants: [], tags: ['planning', 'operations', 'meeting'], summary: 'A useful summary', actionItems: [] }) })
    const provider = new OpenAIProvider('fake', { responses: { create } } as unknown as OpenAI)
    await provider.summarize('gpt-5.4-mini', [{ id: 'one', start: 0, end: 1, text: 'Hello', speakerId: null, speakerName: 'Dana' }], DEFAULT_AI_SETTINGS)
    expect(create.mock.calls[0][0]).toMatchObject({ store: false, text: { format: { type: 'json_schema', strict: true } } })
    expect(create.mock.calls[0][0].input).toContain('Dana')
  })
})
