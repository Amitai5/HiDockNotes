import * as SwitchPrimitive from '@radix-ui/react-switch'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }>(function Button({ children, variant = 'secondary', busy, className = '', disabled, ...props }, ref) {
  return <button ref={ref} className={`button button-${variant} ${className}`} disabled={disabled || busy} {...props}>{busy && <LoaderCircle className="animate-spin" size={15} />}{children}</button>
})
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean; label: string }): JSX.Element {
  return <SwitchPrimitive.Root className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}><SwitchPrimitive.Thumb className="switch-thumb" /></SwitchPrimitive.Root>
}
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }): JSX.Element {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>
}
export function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(1)} GB` }
export function formatDuration(value: number | null): string { if (value === null || !Number.isFinite(value)) return '—'; const s = Math.round(value); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
