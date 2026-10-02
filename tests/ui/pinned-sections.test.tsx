// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

/*
 * KH-06: GSAP ScrollTrigger `pin: true` moves the pinned element into a new
 * "pin-spacer" div. If that element is the component's root node, React later
 * calls parent.removeChild(element) on a node that is no longer a child of the
 * parent and the whole app goes blank. This stub does exactly what GSAP does.
 */
vi.mock('gsap/ScrollTrigger', () => ({
  ScrollTrigger: {
    create: ({ trigger }: { trigger: HTMLElement }) => {
      const spacer = document.createElement('div');
      spacer.className = 'pin-spacer';
      trigger.parentNode!.insertBefore(spacer, trigger);
      spacer.appendChild(trigger);
      return {
        kill: () => {
          if (spacer.parentNode) spacer.parentNode.insertBefore(trigger, spacer);
          spacer.remove();
        },
      };
    },
  },
}));
vi.mock('gsap', () => ({ default: { registerPlugin: () => undefined } }));

const pinned = [
  ['About › ZeroKnowledgeDiagram', () => import('@/components/about/ZeroKnowledgeDiagram')],
  ['Home › EncryptionStory', () => import('@/components/home/EncryptionStory')],
] as const;

describe('pinned scroll sections can be unmounted (KH-06)', () => {
  it.each(pinned)('%s: leaving the page does not throw', async (_name, load) => {
    const { default: Section } = await load();
    const main = document.createElement('main');
    document.body.appendChild(main);
    const view = render(<Section />, { container: main });
    expect(main.querySelector('.pin-spacer')).not.toBeNull(); // pinned like in the browser
    expect(() => view.unmount()).not.toThrow();
    main.remove();
  });
});
