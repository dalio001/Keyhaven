/**
 * OtpInput — 6 segmented authenticator code boxes (design.md §6.4).
 * One hidden real input spans the group so typing, auto-advance, paste-fill
 * and mobile OTP autofill all work natively. Digits land with an 80ms pop,
 * errors shake (x ±6px, 300ms) with danger borders, success pops a mint
 * check per box with a 60ms stagger.
 */

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  /** fired once when the 6th digit lands */
  onComplete?: (v: string) => void;
  disabled?: boolean;
  /** danger border state */
  error?: boolean;
  /** increment to (re)trigger the shake animation */
  shakeKey?: number;
  /** mint success state (checks pop per box) */
  success?: boolean;
  autoFocus?: boolean;
  id?: string;
}

const BOXES = 6;

export default function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  error,
  shakeKey = 0,
  success,
  autoFocus,
  id,
}: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const handleChange = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, BOXES);
    onChange(next);
    if (next.length === BOXES && onComplete) {
      // let state settle before the parent verifies
      setTimeout(() => onComplete(next), 0);
    }
  };

  return (
    <motion.div
      key={shakeKey}
      animate={shakeKey > 0 ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.3 }}
      className="relative w-fit"
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="Six-digit authenticator code"
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="flex gap-2" aria-hidden>
        {Array.from({ length: BOXES }, (_, i) => {
          const digit = value[i] ?? '';
          const isActive = focused && !disabled && i === Math.min(value.length, BOXES - 1);
          return (
            <div
              key={i}
              className={cn(
                'relative flex h-[52px] w-11 items-center justify-center rounded-md border bg-kh-base font-mono text-[20px] font-medium transition-colors duration-150',
                error
                  ? 'border-kh-danger/70 text-kh-danger'
                  : success
                    ? 'border-kh-mint/60 text-kh-mint'
                    : isActive
                      ? 'border-kh-cyan/70 text-kh-primary shadow-[0_0_0_2px_rgba(56,225,255,.15)]'
                      : 'border-kh-faint/60 text-kh-primary',
              )}
            >
              {digit && (
                <motion.span
                  key={`${i}-${digit}-${value.length}`}
                  initial={{ scale: 1.15, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.08 }}
                >
                  {digit}
                </motion.span>
              )}
              {isActive && !digit && (
                <span className="h-6 w-px animate-caret-blink bg-kh-cyan/80" />
              )}
              {success && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.06, type: 'spring', stiffness: 320, damping: 18 }}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-kh-mint text-[#04110B]"
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </motion.span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}