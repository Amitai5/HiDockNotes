export function libraryUrl(projectId: string | null, all = false): string { return all ? '/library' : projectId ? `/library?project=${encodeURIComponent(projectId)}` : '/library?scope=unfiled' }
export function noteUrl(id: string, projectId: string | null, revision?: number, blockId?: string): string { const params = new URLSearchParams(projectId ? { project: projectId } : { scope: 'unfiled' }); if (revision) params.set('revision', String(revision)); if (blockId) params.set('block', blockId); return `/notes/${encodeURIComponent(id)}?${params}` }

export function recordingUrl(id: string, projectId: string | null): string { return `/library/${encodeURIComponent(id)}?${new URLSearchParams(projectId ? { project: projectId } : { scope: 'unfiled' })}` }
