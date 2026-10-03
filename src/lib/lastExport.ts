/** When this device last exported an encrypted backup (Settings → Vault data), as an ISO time. */
export const LAST_EXPORT_KEY = 'keyhaven:last-export';

export function readLastExport(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY);
  } catch {
    return null;
  }
}
