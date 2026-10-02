# KeyHaven — Every password. One vault. Only you.

A **zero-knowledge, local-first password manager**. All your logins are encrypted **inside your own browser** — there is no server and no account. Without your master password, the stored data is unreadable ciphertext.

> **Security details, limits and the migration advisory:** see [`docs/security-model.md`](docs/security-model.md).
> KeyHaven has **not** been independently audited.

## Unlocking

| Method | What it really does |
|---|---|
| **Master password** | The only key. PBKDF2 turns it into the vault's encryption key; it is never stored. **It cannot be recovered if forgotten.** |
| **Authenticator app (TOTP)** — optional | An extra 6-digit check KeyHaven makes *after* the master password (Google Authenticator, Authy, …). It is **not** part of the encryption: someone with your master password and a copy of the encrypted vault could decrypt it without the code. |
| **Authenticator backup codes** | 8 one-time codes that can replace the 6-digit code (e.g. lost phone). The master password is still required; they **cannot** recover it. |
| ~~Passkeys~~ | **Turned off.** The earlier design stored data that let anyone with a copy of the vault open it without the passkey. Existing vaults are re-encrypted with a fresh key at the next master-password unlock (see the advisory in the security doc). |

Extra protection: **auto-lock timer**, **clipboard auto-clear** (best effort), a short pause after repeated failed attempts (in memory only), masked secrets everywhere.

## How it protects you (the crypto)

1. Your master password → **PBKDF2-SHA256, 600,000 iterations** → a 256-bit, non-extractable key.
2. Your whole vault → **AES-256-GCM** encryption with a fresh IV on every save.
3. Only the **encrypted record** is stored (IndexedDB in your browser). Plaintext is never written to disk or sent anywhere.
4. Every save is committed atomically and checked against the version it was based on, so stale tabs, imports and deletions can't silently overwrite each other; "Saved" is shown only after the write completes.
5. Backup = one **encrypted export file**. Import verifies the file and its password before replacing anything, and keeps the replaced vault until you delete it.

## Features

- **Vault dashboard** — search, categories, favorites, ⌘K command palette, one-click copy with auto-clear, per-login TOTP codes.
- **Create-vault wizard** — master password → optional authenticator QR → backup codes + "no recovery" acknowledgement, in 3 guided steps.
- **Watchtower** — security score, weak / reused / old / breached password audit with one-click fixes, offline breach-style scan.
- **Generator** — passwords, passphrases, PINs with entropy bits + crack-time estimates.
- **Settings** — authenticator, backup codes, master password change, auto-lock, encrypted backup export/import/restore.

## Run it yourself (beginner guide)

You need **Node.js 20** installed ([download here](https://nodejs.org)).

```bash
# 1. Get the code
git clone https://github.com/dalio001/Keyhaven.git
cd Keyhaven

# 2. Install dependencies (this creates package-lock.json automatically)
npm install

# 3. Start the app
npm run build && npm run preview
# or for development: npm run dev

# Run the tests (Vitest)
npm test
```

Open the printed local address in your browser → **Create your vault**.

### Images

The 7 image assets (hero background, vault door, avatars…) are too large for the API that published this repo, so they ship separately as **`keyhaven-images.zip`**. To use them locally: unzip it and drop all files into the `public/` folder (they are referenced as `/hero-fallback.png`, `/unlock-vault.png`, etc.). The app still works without them — images are decorative.

## Tech stack

React 19 · TypeScript · Vite 7 · Tailwind CSS 3.4 · shadcn/ui · Framer Motion · GSAP · Three.js · WebCrypto API · WebAuthn · zxcvbn-ts · qrcode.react

## Project structure

```
src/
  lib/         crypto.ts (PBKDF2+AES-GCM) · totp.ts (RFC 6238) · vault.ts (content model)
  lib/store/   format.ts (versioned formats) · codec.ts (seal/open/migrate) · storage.ts (IndexedDB, compare-and-swap)
               controller.ts (unlock, save lifecycle, import/export, tabs) · backupCodes.ts · tabChannel.ts
  providers/   VaultProvider.tsx (React adapter: auto-lock, clipboard clearing, browser events)
  pages/       Home · Unlock · Vault · Security · Generator · Settings · About
  components/  ui/ (shadcn) + feature folders (vault, unlock, security, generator, settings, about)
```

> **Your passwords never leave your device.** Lose your master password and the vault is unrecoverable — by anyone. Backup codes don't change that. Keep the password safe and keep encrypted backups.
