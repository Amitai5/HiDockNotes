import type { ActionableView } from '../shared/contracts'
import { formatDueDate, isDateOnly } from '../shared/actionables'

export function ActionableDates({ item }: { item: ActionableView }): JSX.Element {
  const created = item.createdAt && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : null
  return <div className="actionable-dates">
    <span>Created {created ? <time dateTime={created}>{new Date(created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time> : <span title="This older action item was saved before creation dates were tracked.">date unavailable</span>}</span>
    <span>{isDateOnly(item.dueDate) ? <>Due <time dateTime={item.dueDate}>{formatDueDate(item.dueDate)}</time></> : 'No due date'}</span>
  </div>
}
