import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useRecordingDrop } from '../hooks/useRecordingDrop'

export function RecordingDropLink({ projectId, to, className, title, children, 'aria-label': label }: { projectId: string | null; to: string; className: string; title?: string; 'aria-label'?: string; children: ReactNode }): JSX.Element {
  const { over, busy, ...events } = useRecordingDrop(projectId)
  return <Link to={to} className={`${className}${over ? ' recording-drop-over' : ''}`} title={title} aria-label={label} aria-busy={busy} data-project-target={projectId ?? 'unfiled'} {...events}>{children}</Link>
}
