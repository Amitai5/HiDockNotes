/** Waits for Chromium's first-run Windows encryption key to reach disk before a second process loads it. */
export async function waitForWindowsEncryptionProfile(read: () => Promise<string>, pause: () => Promise<void>, attempts = 80): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const state = JSON.parse(await read()) as { os_crypt?: { encrypted_key?: unknown } } | null
      if (state && typeof state.os_crypt?.encrypted_key === 'string' && state.os_crypt.encrypted_key.length > 0) return
    } catch (error) {
      // A fresh profile has no Local State yet; an atomic preference write can also be in progress.
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The app encryption profile could not be read.')
    }
    if (attempt + 1 < attempts) await pause()
  }
  throw new Error('The app encryption profile is not ready. Keep HiDockNotes running and reconnect your agent.')
}
