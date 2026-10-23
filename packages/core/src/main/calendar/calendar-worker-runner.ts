import { fork } from 'node:child_process'
import { join } from 'node:path'
import type { CalendarWindow, ParsedCalendarEvent } from './calendar-parser'

export function parseCalendarInWorker(text: string, window: CalendarWindow, signal: AbortSignal): Promise<ParsedCalendarEvent[]> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = fork(join(process.env.WORKER_DIR ?? __dirname, 'calendar-worker.cjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
    let done = false
    const finish = (error?: Error, events?: ParsedCalendarEvent[]): void => {
      if (done) return
      done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.kill()
      if (error) reject(error); else resolve(events ?? [])
    }
    const abort = (): void => finish(new Error('Calendar refresh was cancelled.'))
    const timer = setTimeout(() => finish(new Error('The calendar feed took too long to read. Try a smaller calendar.')), 10000)
    signal.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: { events?: ParsedCalendarEvent[]; error?: string }) => finish(message.error ? new Error(message.error) : undefined, message.events))
    worker.on('error', () => worker.emit('exit', 1, null))
      worker.on('exit', () => finish(new Error('The calendar reader stopped before finishing.')))
    worker.on('spawn', () => worker.send({ text, window }))
  })
}
