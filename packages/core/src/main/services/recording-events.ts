import { EventEmitter } from 'node:events'

// The composition root subscribes the queue; device services do not depend on AI.
export const recordingEvents = new EventEmitter()
export function recordingReady(id: string): void { recordingEvents.emit('verified', id) }
