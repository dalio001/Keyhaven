/**
 * KeyHaven marketing footer (design.md §6.3) — bg/surface, 4 columns,
 * bottom row with mono tagline + vault-ring glyph.
 */

import { Link } from 'react-router';

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Generator', to: '/generator' },
      { label: 'Security', to: '/#security' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'How it works', to: '/about' },
      { label: 'FAQ', to: '/#faq' },
      { label: 'Backups', to: '/about' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy — we can’t see your data', to: '/about' },
      { label: 'Terms', to: '/about' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-kh-line bg-kh-surface">
      <div className="mx-auto max-w-marketing px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="" className="h-8 w-8" />
              <span className="font-display text-lg font-semibold text-kh-primary">
                <span className="text-aurora">Key</span>Haven
              </span>
            </Link>
            <p className="mt-4 max-w-[26ch] text-sm leading-6 text-kh-muted">
              A zero-knowledge vault for every login you own. Encrypted in your browser — never on a server.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-eyebrow text-kh-faint">{col.title}</h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="text-sm text-kh-muted transition-colors hover:text-kh-primary">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h4 className="text-eyebrow text-kh-faint">Status</h4>
            <p className="mt-4 flex items-center gap-2 text-sm text-kh-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-dot-pulse rounded-full bg-kh-mint" />
              </span>
              All systems local — nothing to go down
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-kh-line pt-6 sm:flex-row sm:items-center">
          <p className="text-sm text-kh-faint">© {new Date().getFullYear()} KeyHaven</p>
          <p className="font-mono text-xs text-kh-muted">Your passwords never leave your device.</p>
          {/* small vault-ring glyph */}
          <svg width="28" height="28" viewBox="0 0 200 200" aria-hidden="true">
            <g className="animate-spin-40" style={{ transformOrigin: '100px 100px' }}>
              <circle cx="100" cy="100" r="88" fill="none" stroke="#35F0A1" strokeOpacity="0.6" strokeWidth="8" strokeDasharray="6 18" />
            </g>
            <g className="animate-spin-28r" style={{ transformOrigin: '100px 100px' }}>
              <circle cx="100" cy="100" r="56" fill="none" stroke="#38E1FF" strokeOpacity="0.6" strokeWidth="8" strokeDasharray="24 16" />
            </g>
          </svg>
        </div>
      </div>
    </footer>
  );
}
