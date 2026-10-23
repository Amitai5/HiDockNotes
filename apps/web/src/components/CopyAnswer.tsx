import { appClient } from '../services/app-client'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function CopyAnswer({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false), [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current) } }, [])
  async function copy(): Promise<void> {
    setBusy(true)
    try {
      await appClient.app.copyText(text)
      if (!mounted.current) return
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) { if (mounted.current) reportError(error) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <Button className="chat-copy" variant="ghost" aria-label={copied ? 'Answer copied' : 'Copy answer'} title={copied ? 'Copied' : 'Copy answer'} disabled={busy || !text} onClick={() => { void copy() }}>{copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? 'Copied' : 'Copy'}</span></Button>
}
