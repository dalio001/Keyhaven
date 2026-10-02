# KeyHaven security model and data lifecycle

This document describes what KeyHaven **actually implements** as of the Phase 1 vault hardening. It is
written for the owner of the vault and for reviewers. It is **not** the result of an independent security
audit, and nothing here is a guarantee beyond the behaviour described and tested in this repository.

- [What is stored, and where](#what-is-stored-and-where)
- [Keys and encryption](#keys-and-encryption)
- [Unlocking](#unlocking)
- [There is no master-password recovery](#there-is-no-master-password-recovery)
- [Saving changes](#saving-changes)
- [Backups: export, import, restore](#backups-export-import-restore)
- [Formats, versions and migration](#formats-versions-and-migration)
- [Advisory: legacy passkey unlock](#advisory-legacy-passkey-unlock)
- [Known limitations](#known-limitations)
- [Tests](#tests)

---

## What is stored, and where

Everything lives in the browser profile that runs KeyHaven. Nothing is sent to a server.

| Location | Contents | Secret? |
|---|---|---|
| IndexedDB `keyhaven` (DB version 2), store `vault`, key `current` | The vault record (below) | Ciphertext + public metadata |
| same store, key `previous` | The vault replaced by the last import/restore, if any (deletable from Settings) | Ciphertext + public metadata |
| `localStorage` `keyhaven.lastMethod`, `keyhaven:last-export`, `keyhaven:prefs`, `keyhaven.watchtower.ignored`, `keyhaven:migration-ack:<vaultId>` | UI preferences, last export time, acknowledged notices, Watchtower "ignored" entry ids | No |
| `sessionStorage` `kh-vault-welcomed` | Welcome-toast flag | No |

### The vault record (format v2)

| Field | Meaning | Visible without the password |
|---|---|---|
| `version` | Record format (`2`) | yes |
| `vaultId` | Random id of this vault's lineage | yes |
| `revision` | Write counter | yes |
| `commitId` | Random id of the write that produced the record (compare-and-swap token) | yes |
| `salt`, `kdf` | PBKDF2 salt and parameters | yes |
| `verifier` | SHA-256 of the derived key bits (rejects a wrong password before decrypting) | yes |
| `blob` | AES-256-GCM ciphertext of the vault payload (logins, accounts, subscriptions, settings, authenticator backup codes, and any future data) | **encrypted** |
| `totpEnabled`, `totpSecretEncrypted` | Whether the authenticator check is on; its secret, encrypted with the vault key | flag yes, secret **encrypted** |
| `createdAt`, `updatedAt`, `migratedFrom` | Timestamps; details of a legacy-format upgrade | yes |

Someone who copies the record learns these metadata values (for example how many times the vault was
saved and whether the authenticator is enabled), but not the entries, passwords, notes, codes or secrets.

### Accounts and subscriptions

Accounts (one sign-up at one service) and subscriptions (plan, price, billing cycle and dates, status,
who bills you) live **inside the encrypted payload**, next to the logins. They are therefore encrypted
with the vault key and included in every encrypted backup. Nothing about them is visible in the stored
record, and nothing is looked up online: prices and dates are exactly what you entered.

- **Links point from the child to the account.** A login or subscription stores `accountId`; an account
  never lists its children. Deleting a login (even with an older KeyHaven) leaves its account and
  subscriptions in place. Deleting or canceling a subscription never touches a login. An account that still
  has subscriptions can't be removed, and removing one only unlinks its logins.
- **Dates are calendar days** (`YYYY-MM-DD`), stored exactly as entered and never converted with the
  Date constructor, so no time zone or daylight-saving change can shift them. Later renewals are worked
  out from the date you entered (Jan 31 monthly → Feb 28/29 → Mar 31) when shown, and nothing is
  written back.
- **Prices are whole minor units** (cents) plus an ISO 4217 currency code. Different currencies are never
  added together.

---

## Keys and encryption

- **Key derivation:** PBKDF2-HMAC-SHA-256 with 600,000 iterations over the UTF-8 master password and a
  random 16-byte salt yields 256 bits. They are imported as a **non-extractable** AES-GCM key: application code
  can encrypt and decrypt with it but cannot export it. The derived bits are zeroed after import (best
  effort).
- **Verifier:** `SHA-256(derived bits)`. Anyone holding the record can test password guesses against it.
  Each guess costs the full PBKDF2 work, the same as trying to decrypt the blob, so it does not weaken
  the encryption. It is still why a long, unique master password matters.
- **Encryption:** AES-256-GCM with a fresh random 96-bit IV for every save. GCM authentication detects
  modification of the ciphertext or IV. KeyHaven then reports "failed its integrity check", not "wrong
  password".
- **Key hierarchy:** none. The password-derived key encrypts the payload directly. Changing the master
  password therefore re-encrypts everything with a key from a new salt.
- **No other key material is stored.** Nothing stored next to the record can rebuild the vault key
  without the master password. This was **not** true before Phase 1; see the
  [advisory](#advisory-legacy-passkey-unlock).

---

## Unlocking

### Master password: the only key

The master password is the only thing that can decrypt the vault.

### Authenticator app (TOTP): an extra check by the app

When enabled, KeyHaven asks for a 6-digit RFC 6238 code after the master password has been verified.

What it does:
- It stops someone who knows or observes your master password from unlocking **through KeyHaven** if they
  don't also have your phone or a backup code.

What it does **not** do:
- It is **not part of the encryption**. The TOTP secret is itself encrypted with the vault key. Someone with
  your master password **and** a copy of the encrypted record can decrypt it without the authenticator.
  The copy could come from this browser's storage or from a backup file. The same is true of anyone who
  can run code in the page, such as through developer tools or a malicious extension.
- Codes are accepted within ±1 time step, roughly a 90-second window. A code is not blocked from being reused
  inside that window.
- The unlock flow shows that the password was correct before asking for the code. An offline attacker can
  learn this from the verifier anyway.
- **Disabling or replacing** the authenticator requires the current code or a backup code.

### Authenticator backup codes

- Eight random codes like `KQ7M-4PDX-9T2A` (about 59 bits each), stored **inside the encrypted payload**.
  The field is still called `recoveryCodes` for compatibility.
- One code can be used **once** instead of the 6-digit code: at unlock, or to disable or replace the
  authenticator. **The master password is always still required.**
- A used code is removed and saved **before** the vault opens. If that save fails, the unlock fails and
  the code stays valid.
- They matter only while the authenticator is enabled.
- If the stored authenticator secret is damaged, a backup code still unlocks the vault and turns the
  authenticator off, with a notice.
- They **cannot** recover a forgotten master password.

### Passkeys: disabled

Passkey unlock and registration have been removed. The previous design was insecure; see the
[advisory](#advisory-legacy-passkey-unlock). A replacement must get its key material from the
authenticator itself, for example through the WebAuthn PRF extension. It needs its own design and review.

### Failed attempts

After five wrong passwords or codes, the unlock form pauses for 30 seconds. The pause lives in page
memory and **a reload resets it**. The real protection against guessing is the PBKDF2 cost and the
strength of the master password.

### Auto-lock

After the configured inactivity time the vault locks. The "Only when the tab closes" option disables the
timer. Locking first encrypts any unsaved change with the current key, then drops the key and the
decrypted data from memory. See [Saving changes](#saving-changes).

The timer is paused while the create-vault wizard is open (from the moment the vault is created until
the wizard finishes), because setting up the authenticator and writing down backup codes happens away
from the keyboard. The new vault holds only sample entries at that point. If the vault locks anyway
during setup (for example, it was unlocked in another tab), the wizard says so and sends you to unlock.

---

## There is no master-password recovery

The vault key is derived only from the master password, and the password is never stored. Nothing can
recover a forgotten master password: not KeyHaven, not backup codes, not a backup file. A backup file
opens only with the master password that was in use when it was exported.

If the password is lost, the only option is **Forgot master password? → Start over**. It deletes the
encrypted vault from this browser, including any vault kept in the "previous vault" slot.

---

## Saving changes

All persistence goes through one controller (`src/lib/store/controller.ts`). It follows these rules.

1. **Every change applies in memory, then is encrypted and written.** Writes run one at a time. Each one
   carries the newest state, so a burst of edits produces a few writes, never overlapping ones.
2. **Every write is a compare-and-swap.** A write succeeds only if the stored record is still the one it was
   based on, compared by `vaultId` + `commitId` inside a single IndexedDB transaction. Otherwise it fails
   with a *conflict* and **never overwrites**. This covers other tabs, imports, deletions and stale tabs.
3. **"Saved" means committed.** The save-status chip and the "Login saved" toasts appear only after the
   write has completed (IndexedDB `complete`, durability `strict` requested). Failures show *Not saved yet*
   with **Retry**. KeyHaven also retries automatically with backoff.
4. **Lock:** pending changes are encrypted *before* the key is dropped, and the encrypted write then finishes.
   If storage keeps failing, the encrypted pending record stays in memory (never the decrypted data). The
   lock screen then offers **Retry saving**, **Download encrypted copy** or **Discard**. Unlocking is refused
   until one of these is done, so an older stored version can't silently replace newer work.
5. **Export** first saves pending changes, then reads back and exports exactly the stored record. If saving
   fails, it offers the unsaved changes as a clearly labelled **encrypted** file instead of a stale backup.
6. **Import, restore, delete and password change** wait for in-flight writes and are serialized with them.
   - A write that was still in flight can't recreate a deleted vault or overwrite an imported one.
   - A password change re-encrypts the latest in-memory state and switches keys atomically.
   - Locking during a password change waits for it, so data is never written with mixed keys.
7. **Several tabs:** only one tab can be unlocked at a time. Unlocking in a second tab saves and locks the
   first, with an explanation.
   - Locked tabs refresh their status when another tab changes the vault.
   - A clean, unlocked tab that missed a message reloads newer data in place.
   - A tab with unsaved changes gets a *conflict* and keeps those changes as a downloadable encrypted copy.
   - Messages between tabs (BroadcastChannel) are only hints. Compare-and-swap is what prevents
     overwrites.
8. **Tabs running the pre-Phase-1 code** cannot write any more. The IndexedDB version moved from 1 to 2;
   old code fails to open the database. While such a tab is still open, the updated app shows "Close
   other KeyHaven tabs" instead of proceeding.
9. **Closing the browser:**
   - Writes start immediately (there is no debounce) and normally finish within milliseconds.
   - While a change is unsaved, KeyHaven asks the browser to show its "leave page?" prompt, and it saves
     when the page is hidden.
   - Browsers can still kill a page (crash, forced quit, OS shutdown) before a write completes. That last
     edit is then lost. The browser decides whether the prompt appears.

---

## Backups: export, import, restore

- **Export** (Settings → Vault & data) downloads `keyhaven-backup-YYYY-MM-DD.json`. It contains the stored
  v2 record: ciphertext plus the public metadata above. It opens only with the master password in use at
  export time. Export again after changing the password.
- **Import** checks everything **in memory before anything is replaced**:
  1. file format and version (newer formats are refused, never downgraded);
  2. the master password (verifier);
  3. decryption and integrity of the contents.

  If any check fails, nothing changes.

  The current vault is then replaced in one atomic write and **kept as the "previous vault"**. It can be
  restored (the two swap places) or deleted from Settings. Import also works on a device with no vault:
  *Restore from an encrypted backup* on the unlock page. If the imported vault uses the authenticator, it
  stays locked until unlocked with its password and code.
- **Legacy (v1) backups** are accepted and upgraded during import: new salt and key, passkey data removed.
  The original file is not modified. If it contained passkey data, KeyHaven warns that the file itself
  remains unsafe.
- **Damaged stored vault:** KeyHaven reports it instead of treating it as "no vault". It never offers to
  create over it. You can restore a backup, which keeps the damaged data as the previous vault, or delete it.

---

## Formats, versions and migration

| Thing | Before Phase 1 | Now | Rule |
|---|---|---|---|
| Vault record | `version: 1` (optional `passkeys`) | `version: 2` | v1 is read, migrated on the next master-password unlock, and never written again |
| Backup file | `version: 1` wrapper or bare record | `version: 2` wrapper | v1 and v2 accepted; v1 is migrated on import |
| IndexedDB | DB version 1 | DB version 2 | Same store and keys; the bump only fences old code |
| Encrypted payload | `{ entries, settings, recoveryCodes }` | same, plus any unknown fields | Unknown fields (including per-entry `totpSecret`, `passwordHistory`) are preserved |
| Accounts & subscriptions | — | optional `accounts`, `subscriptions` arrays in the payload; optional `accountId` on logins | Added only once you create one; no record-version bump (see below) |

- `record.version` (readable without the password) is the single format gate. A record or backup with a
  **newer** version is refused with "update KeyHaven" and left untouched. It is never downgraded or rewritten.
- Within a known version, unknown top-level and per-entry fields are preserved on every save.
- Accounts and subscriptions did **not** need a new record version. The Phase-1 build already preserves
  unknown payload keys and login fields, so editing or deleting logins there keeps them intact (tested in a
  real browser on the same origin). A version bump would have locked older tabs out of the whole vault.
  If the stored account or subscription data is ever malformed, it is kept verbatim and editing it is
  turned off; the vault still opens.

### How a legacy vault is migrated

This runs on the first successful **master-password** unlock after updating.

1. Read the stored v1 record fresh from storage.
2. Verify the master password. If the authenticator is enabled, verify its code or a backup code.
   **Nothing is written until both checks pass.**
3. Decrypt and validate the contents.
4. Generate a **new random salt**, derive a **new key** from the same master password, and re-encrypt the
   contents and the authenticator secret with fresh IVs. Drop the passkey data.
5. Re-open what was just encrypted and compare it with the original (self-check).
6. Write the v2 record in one compare-and-swap against the exact v1 record. A backup code used to unlock is
   consumed in the same write.

On any failure the stored record stays **byte-for-byte unchanged**, the vault stays locked, and KeyHaven
reports *"The one-time security upgrade couldn't be saved, so nothing was changed"*. Retry after freeing
storage or closing other tabs. If two tabs migrate at once, exactly one write wins and the other tab opens
the migrated vault.

**All** v1 vaults are rotated, not only those that still hold a passkey. A passkey that was removed
earlier leaves no trace in the record, but backups made while it existed still contain it.

---

## Advisory: legacy passkey unlock

**Problem (confirmed).** Before Phase 1, registering a passkey stored a "wrapped" copy of the vault key in
the record. The wrapping key was `SHA-256(credential ID ‖ salt)`, and the credential ID and salt were stored
right next to it. The WebAuthn prompt was shown, but its result was never needed to unwrap anything.

So **anyone with a copy of the vault record could decrypt the whole vault without the master password and
without the passkey.** The copy could come from this browser's storage or from an exported backup file
made while a passkey was registered. Passkey unlock also skipped the authenticator check.

`tests/migration-codec.test.ts` reproduces the flaw. The end-to-end check used for this change reproduced
it in Chromium as well.

**What the update does:**
- Passkey unlock and registration are removed.
- Every legacy vault is re-encrypted with a **new key** at the next master-password unlock, and its passkey
  data is deleted.
- A key recovered from an old record or backup **cannot** open the migrated vault or any backup exported
  after migration (tested).

**What it cannot repair:** copies that already exist. These include:
- backup files exported while a passkey was registered;
- browser-profile backups or synced profile copies;
- data left on disk by the browser's storage engine.

They can still be opened without your master password. They expose the entries, the authenticator secret
and the backup codes **as they were at the time of the copy**.

**Recommended after upgrading:**
1. Export a fresh encrypted backup, then delete older backup files and their copies.
2. If someone else may have had access to an older copy, change the passwords stored in your vault,
   starting with the most important accounts. Also change your master password.
3. Regenerate your authenticator backup codes, and replace your authenticator (Settings → Authenticator →
   Replace).

The master password itself is not revealed by the flaw. PBKDF2 is one-way, and an attacker with the
leaked key did not need it.

---

## Known limitations

- **No independent audit.** The design uses standard WebCrypto primitives, but this repository has not been
  audited.
- **A compromised page or device defeats everything while the vault is unlocked.** This includes cross-site
  scripting, malicious extensions, and malware with access to the browser. Decrypted data lives in
  JavaScript memory and cannot be reliably wiped.
- **Browser storage can be evicted.**
  - Browsers may delete site data under storage pressure, or after a period without use. Safari
    applies a 7-day rule to script-writable storage.
  - KeyHaven does not yet request persistent storage.
  - Keep encrypted backups.
- **Secure deletion is not possible.** Deleting a vault or old record removes it from IndexedDB. The
  browser's storage engine may keep fragments on disk until they are compacted.
- **Unlock throttling** lives in memory only (see [Failed attempts](#failed-attempts)).
- **Clipboard auto-clear** is best effort. Clipboard managers and OS history may keep copies.
- **One unlocked tab at a time** by design. Cross-tab messages can be missed, for example by frozen
  background tabs. Compare-and-swap still prevents overwrites, but a stale tab may then report a conflict.
- **New vaults are seeded with sample entries** (existing behaviour, unchanged here).
- **Subscription details are what you enter.** KeyHaven doesn't fetch prices, verify renewals, charge or
  cancel anything, and has no currency conversion. Totals, reminders and cancellation help are later work.

---

## Tests

```bash
npm test        # Vitest — unit + integration (fake-indexeddb) + jsdom UI tests
npm run build   # type-checks app and tests, then builds
npm run lint
```

| Area | Files |
|---|---|
| Key derivation compatibility, wrong password, tampering, non-extractable keys | `tests/crypto.test.ts` |
| Format validation, version gating, field preservation, backup codes | `tests/format.test.ts` |
| Legacy passkey flaw, migration with key rotation, re-key | `tests/migration-codec.test.ts` |
| IndexedDB compare-and-swap, atomic replace/restore, DB version fence, timeouts | `tests/storage.test.ts` |
| Edit→lock, edit→export, rapid edits, storage failures, failure across lock, landed-but-timed-out writes, lock during password change, create never overwrites | `tests/controller-save.test.ts` |
| Unlock results, corruption, newer versions, migration (success, no write before checks pass, failure + retry, concurrent), backup codes | `tests/controller-unlock.test.ts` |
| Import/restore/delete with pending writes, stale-write conflicts, legacy imports, export fallbacks, damaged records | `tests/controller-admin.test.ts` |
| One unlocked tab, refresh, lost messages, reload in place | `tests/controller-tabs.test.ts` |
| Unlock screen claims vs behaviour, provider save state, unload warning | `tests/ui/unlock.test.tsx` |
| Account/subscription operations: links, removal rules, malformed data kept verbatim | `tests/records.test.ts` |
| Billing dates (month ends, leap years, custom intervals, time zones), money, derived status | `tests/billing-*.test.ts` |
| Subscriptions encrypted at rest, in backups, through lock/unlock, legacy upgrade and Phase-1-style edits | `tests/subscriptions-store.test.ts` |
| Subscription form: validation, dates kept as strings, distinct accounts | `tests/subscription-form.test.ts`, `tests/ui/subscriptions.test.tsx`, `tests/ui/provider-records.test.tsx` |

Golden fixtures in `tests/fixtures/` were generated with the pre-Phase-1 code, using synthetic passwords and
data only. `tests/legacy/v1.ts` keeps a frozen copy of the legacy algorithms for these tests; application
code never imports it.
