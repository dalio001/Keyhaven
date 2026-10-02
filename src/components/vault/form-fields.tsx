/** Field primitives shared by the vault and subscription forms. */

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-eyebrow block text-kh-faint">
      {children}
    </label>
  );
}

export function FieldError({ show, children }: { show: boolean; children: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden text-xs text-kh-danger"
        >
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
