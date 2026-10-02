/**
 * KeyHaven shared layout — nested-route (Outlet) pattern.
 *
 * Navbar is `fixed` (72px, overlay style per design.md §6.1), so this Layout
 * owns the offset: the content slot gets `pt-[72px]` and every page starts
 * below the nav. Page agents: do NOT add nav-height padding yourselves.
 * A full-bleed hero opts out inside its own page (negative top margin),
 * never by removing this offset.
 */

import { Outlet } from 'react-router';
import Navbar from './Navbar';
import Footer from './Footer';
import VaultNotices from './VaultNotices';

export default function Layout() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-kh-base text-kh-primary">
      <Navbar />
      <main className="flex-1 pt-[72px]">
        <Outlet />
      </main>
      <Footer />
      <VaultNotices />
    </div>
  );
}
