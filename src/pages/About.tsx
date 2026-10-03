/**
 * /about — "How KeyHaven protects you" (design/about.md). Marketing/trust
 * page: hero, pinned 250vh zero-knowledge scroll diagram, crypto building
 * blocks, you-see vs anyone-else split, principles, security FAQ, final CTA.
 * Lenis smooth scroll + decorative cursor ring; Navbar/Footer from Layout.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import Lenis from 'lenis';
import CursorRing from '@/components/CursorRing';
import AboutHero from '@/components/about/AboutHero';
import ZeroKnowledgeDiagram from '@/components/about/ZeroKnowledgeDiagram';
import BuildingBlocks from '@/components/about/BuildingBlocks';
import TwoViews from '@/components/about/TwoViews';
import PrinciplesStrip from '@/components/about/PrinciplesStrip';
import AboutFaq from '@/components/about/AboutFaq';
import AboutCta from '@/components/about/AboutCta';

export default function About() {
  const location = useLocation();

  // Lenis smooth scroll (marketing pages only), lerp 0.09 per design.md §5
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.09 });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  // honor /about#section links (the footer's Privacy link goes to #privacy)
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
    return () => clearTimeout(t);
  }, [location.hash]);

  return (
    <>
      <CursorRing />
      <AboutHero />
      <ZeroKnowledgeDiagram />
      <BuildingBlocks />
      <TwoViews />
      <PrinciplesStrip />
      <AboutFaq />
      <AboutCta />
    </>
  );
}