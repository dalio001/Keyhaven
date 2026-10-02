import { describe, expect, it } from 'vitest';
import {
  currencyOptions,
  formatMoney,
  fractionDigits,
  isCurrencyCode,
  minorToInput,
  parseMoneyInput,
} from '@/lib/billing/money';

describe('money', () => {
  it('knows how many decimals each currency uses', () => {
    expect(fractionDigits('USD')).toBe(2);
    expect(fractionDigits('EUR')).toBe(2);
    expect(fractionDigits('JPY')).toBe(0);
    expect(fractionDigits('KWD')).toBe(3);
  });

  it('parses typed prices into integer minor units', () => {
    expect(parseMoneyInput('20', 'USD')).toBe(2000);
    expect(parseMoneyInput('20.00', 'USD')).toBe(2000);
    expect(parseMoneyInput('19,99', 'EUR')).toBe(1999);
    expect(parseMoneyInput(' 1 200 ', 'USD')).toBe(120000);
    expect(parseMoneyInput('0.5', 'USD')).toBe(50);
    expect(parseMoneyInput('20.', 'USD')).toBe(2000);
    expect(parseMoneyInput('1500', 'JPY')).toBe(1500);
    expect(parseMoneyInput('3.500', 'KWD')).toBe(3500);
    expect(parseMoneyInput('0', 'USD')).toBe(0);
  });

  it('refuses input it would have to guess at', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1,234.50', '12.5.0', '$20', '1e3']) {
      expect(parseMoneyInput(bad, 'USD')).toBeNull();
    }
    expect(parseMoneyInput('1500.5', 'JPY')).toBeNull();
    expect(parseMoneyInput('99999999999999999999', 'USD')).toBeNull();
  });

  it('round-trips through the form text box', () => {
    expect(minorToInput(2000, 'USD')).toBe('20.00');
    expect(minorToInput(5, 'USD')).toBe('0.05');
    expect(minorToInput(1500, 'JPY')).toBe('1500');
    expect(minorToInput(3500, 'KWD')).toBe('3.500');
    for (const [minor, cur] of [[1999, 'EUR'], [1, 'USD'], [123456, 'KWD']] as const) {
      expect(parseMoneyInput(minorToInput(minor, cur), cur)).toBe(minor);
    }
  });

  it('formats with the currency symbol', () => {
    expect(formatMoney(2000, 'USD', 'en-US')).toBe('$20.00');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney(1999, 'EUR', 'de-DE').replace(/\s/g, ' ')).toBe('19,99 €');
  });

  it('validates currency codes and lists common ones first', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('US')).toBe(false);
    expect(isCurrencyCode(42)).toBe(false);
    const opts = currencyOptions();
    expect(opts.slice(0, 3)).toEqual(['USD', 'EUR', 'GBP']);
    expect(new Set(opts).size).toBe(opts.length);
    expect(opts).toContain('JPY');
  });
});
