/**
 * KeyHaven marketing navbar — fixed overlay nav (design.md §6.1).
 * Transparent at top → bg/base 80% + blur(16px) + subtle bottom border after
 * 40px scroll. Center links with scroll-spy mint underline on the home page.
 * Mobile: hamburger → full-screen overlay, links stagger up.
 *
 * Positioning contract: this nav is `fixed` (72px). The shared `Layout` owns
 * the matching top padding — pages never compensate for nav height.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVault } from '@/providers/VaultProvider';

const NAV_LINKS = [
  { label: 'Features', to: '/#features', hash: 'features' },
  { label: 'Security', to: '/#security', hash: 'security' },
  { label: 'Generator', to: '/generator', hash: null },
  { label: 'About', to: '/about', hash: null },
] as const;

const CTA_SECONDARY = 'rounded-full px-4 py-2 text-sm font-medium text-kh-muted transition-colors hover:text-kh-primary';
const CTA_PRIMARY =
  'bg-aurora group flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]';
const CTA_ARROW = 'h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5';
const MOBILE_PRIMARY = 'bg-aurora rounded-full px-6 py-3 text-center text-base font-semibold text-[#04110B]';

export default function Navbar() {
  // the actions follow the vault (KH-11): open / lock it when unlocked, unlock it when one exists
  const { status, lock } = useVault();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [spy, setSpy] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40);
      if (location.pathname === '/') {
        let current: string | null = null;
        for (const id of ['features', 'security']) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4) current = id;
        }
        setSpy(current);
      } else {
        setSpy(null);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const goHash = (hash: string) => (e: React.MouseEvent) => {
    if (location.pathname === '/') {
      e.preventDefault();
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isActive = (link: (typeof NAV_LINKS)[number]) => {
    if (link.hash) return spy === link.hash;
    return location.pathname === link.to;
  };

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 h-[72px] transition-all duration-300',
          scrolled ? 'border-b border-kh-line bg-kh-base/80 backdrop-blur-[16px]' : 'border-b border-transparent',
        )}
      >
        <div className="mx-auto flex h-full max-w-marketing items-center justify-between px-6">
          {/* logo */}
          <Link to="/" className="flex items-center gap-2.5" aria-label="KeyHaven home">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            <span className="font-display text-[19px] font-semibold tracking-tight text-kh-primary">
              <span className="text-aurora">Key</span>Haven
            </span>
          </Link>

          {/* center links */}
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                onClick={link.hash ? goHash(link.hash) : undefined}
                className={cn(
                  'group relative py-2 text-sm font-medium transition-colors',
                  isActive(link) ? 'text-kh-primary' : 'text-kh-muted hover:text-kh-primary',
                )}
              >
                {link.label}
                <span
                  className={cn(
                    'absolute -bottom-0.5 left-0 h-0.5 bg-kh-mint transition-all duration-300',
                    isActive(link) ? 'w-full' : 'w-0 group-hover:w-full',
                  )}
                />
              </Link>
            ))}
          </nav>

          {/* right CTAs */}
          <div className="hidden items-center gap-3 md:flex">
            {status === 'unlocked' ? (
              <>
                <button type="button" onClick={() => void lock()} className={CTA_SECONDARY}>
                  Lock
                </button>
                <Link to="/vault" className={CTA_PRIMARY}>
                  Open vault
                  <ArrowRight className={CTA_ARROW} />
                </Link>
              </>
            ) : status === 'locked' ? (
              <Link to="/unlock" className={CTA_PRIMARY}>
                Unlock vault
                <ArrowRight className={CTA_ARROW} />
              </Link>
            ) : (
              <>
                <Link to="/unlock" className={CTA_SECONDARY}>
                  Unlock vault
                </Link>
                <Link to="/unlock?mode=create" className={CTA_PRIMARY}>
                  Create your vault
                  <ArrowRight className={CTA_ARROW} />
                </Link>
              </>
            )}
          </div>

          {/* mobile hamburger */}
          <button
            className="flex h-10 w-10 items-center justify-center rounded-lg text-kh-primary md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* mobile overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex flex-col bg-kh-base/[0.98] backdrop-blur-sm md:hidden"
          >
            <div className="flex h-[72px] items-center justify-between px-6">
              <span className="flex items-center gap-2.5">
                <img src="/logo.svg" alt="" className="h-8 w-8" />
                <span className="font-display text-[19px] font-semibold text-kh-primary">
                  <span className="text-aurora">Key</span>Haven
                </span>
              </span>
              <motion.button
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-kh-primary"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </motion.button>
            </div>
            <nav className="flex flex-1 flex-col items-start justify-center gap-2 px-8" aria-label="Mobile">
              {NAV_LINKS.map((link, i) => (
                <motion.div
                  key={link.label}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * i + 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Link
                    to={link.to}
                    onClick={link.hash ? goHash(link.hash) : undefined}
                    className="font-display text-4xl font-semibold text-kh-primary"
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * NAV_LINKS.length + 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="mt-8 flex flex-col gap-3"
              >
                {status === 'unlocked' ? (
                  <>
                    <button type="button" onClick={() => void lock()} className="text-left text-lg font-medium text-kh-muted">
                      Lock
                    </button>
                    <Link to="/vault" className={MOBILE_PRIMARY}>
                      Open vault
                    </Link>
                  </>
                ) : status === 'locked' ? (
                  <Link to="/unlock" className={MOBILE_PRIMARY}>
                    Unlock vault
                  </Link>
                ) : (
                  <>
                    <Link to="/unlock" className="text-lg font-medium text-kh-muted">
                      Unlock vault
                    </Link>
                    <Link to="/unlock?mode=create" className={MOBILE_PRIMARY}>
                      Create your vault
                    </Link>
                  </>
                )}
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
