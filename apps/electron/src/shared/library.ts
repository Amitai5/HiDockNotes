import type { ProjectView, RecordingView } from './contracts'

export interface LibraryNavigation {
  projects: ProjectView[]
  looseRecordings: Pick<RecordingView, 'id' | 'filename' | 'title'>[]
}
