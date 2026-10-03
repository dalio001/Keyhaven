import { describe, expect, it } from 'vitest';
import { clearSecret, offerSecret, peekSecret } from '@/lib/handoff';

describe('in-memory secret handoff (KH-01)', () => {
  it('holds one secret until it is cleared', () => {
    offerSecret('Synthetic-Gen-Secret-42', 1_000);
    expect(peekSecret(1_500)).toBe('Synthetic-Gen-Secret-42');
    expect(peekSecret(2_000)).toBe('Synthetic-Gen-Secret-42'); // peeking doesn't consume
    clearSecret();
    expect(peekSecret(2_500)).toBeNull();
  });

  it('expires after a minute', () => {
    offerSecret('Synthetic-Gen-Secret-42', 0);
    expect(peekSecret(60_000)).toBe('Synthetic-Gen-Secret-42');
    expect(peekSecret(60_001)).toBeNull();
    expect(peekSecret(0)).toBeNull(); // gone for good once expired
  });

  it('a newer offer replaces the older one', () => {
    offerSecret('first', 0);
    offerSecret('second', 10);
    expect(peekSecret(20)).toBe('second');
    clearSecret();
  });
});
