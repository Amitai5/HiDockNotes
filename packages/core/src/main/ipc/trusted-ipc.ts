/** Authenticated transports call only procedures registered here; inputs retain domain validation. */
type Procedure = (...args: any[]) => unknown
const procedures = new Map<string, Procedure>()
export function handle(name: string, procedure: Procedure): void { if (procedures.has(name)) throw new Error('Duplicate procedure: ' + name); procedures.set(name, procedure) }
export async function invoke(name: string, args: unknown[]): Promise<unknown> { const procedure = procedures.get(name); if (!procedure) throw new Error('Unknown operation.'); return procedure(...args) }
export function clearProcedures(): void { procedures.clear() }
