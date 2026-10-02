/**
 * Prices as integer minor units (cents) + an ISO 4217 currency code. No
 * floating-point money is ever stored, and amounts in different currencies are
 * never added together (there is no conversion).
 */

const FALLBACK_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'INR', 'SEK', 'NOK', 'DKK', 'PLN'];
/** shown first in the currency picker */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP'];

const CODE_RE = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
  if (typeof value !== 'string' || !CODE_RE.test(value)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value });
    return true;
  } catch {
    return false;
  }
}

/** decimal places the currency uses: USD 2, JPY 0, KWD 3 */
export function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Parse what the user typed ("20", "20.00", "19,99", "1 200") into minor
 * units. `.` or `,` is the decimal mark; more decimals than the currency has
 * ("1.234" in USD) is refused rather than guessed. `null` when invalid.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const t = text.trim().replace(/[\s\u00a0\u202f']/g, '');
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(t);
  if (!match) return null;
  const digits = fractionDigits(currency);
  const frac = match[2] ?? '';
  if (frac.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** minor units back into the form's text box: 2000 USD → "20.00", 1500 JPY → "1500" */
export function minorToInput(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  if (digits === 0) return String(minor);
  const scale = 10 ** digits;
  return `${Math.floor(minor / scale)}.${String(minor % scale).padStart(digits, '0')}`;
}

/** "$20.00", "20,00 €" (locale-dependent) */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const digits = fractionDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 10 ** digits);
  } catch {
    return `${minorToInput(minor, currency)} ${currency}`;
  }
}

/** every currency the browser knows, common ones first */
export function currencyOptions(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: 'currency') => string[] }).supportedValuesOf;
  let all: string[];
  try {
    all = supported ? supported('currency') : FALLBACK_CURRENCIES;
  } catch {
    all = FALLBACK_CURRENCIES;
  }
  return [...COMMON_CURRENCIES, ...all.filter((c) => !COMMON_CURRENCIES.includes(c))];
}
