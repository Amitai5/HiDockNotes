export interface ServerConnection { origin: string | null; error?: string }
export interface ServerConnectionClient { get(): Promise<ServerConnection>; connect(origin: string): Promise<void> }

declare global { interface Window { hidockConnection?: ServerConnectionClient } }
