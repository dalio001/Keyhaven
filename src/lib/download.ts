/**
 * Trigger a browser download of in-memory text.
 *
 * The object URL is revoked only after a delay: revoking it synchronously
 * after `click()` can cancel the download in some browsers (Firefox/Safari).
 * Completion cannot be observed from a web page, so callers should say the
 * file was "created", not "saved".
 */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Download an encrypted KeyHaven backup file (ciphertext only). */
export function downloadBackupFile(text: string, kind: 'backup' | 'unsaved-changes' = 'backup'): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`keyhaven-${kind}-${stamp}.json`, text, 'application/json');
}
