// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

function Boom(): never {
  throw new Error('synthetic render failure');
}

describe('ErrorBoundary (KH-06)', () => {
  it('shows a recoverable message instead of a blank page when a page crashes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); // React logs the caught error
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Something went wrong/);
    expect(screen.getByRole('button', { name: 'Reload KeyHaven' })).toBeTruthy();
    spy.mockRestore();
  });

  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>page content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('page content')).toBeTruthy();
  });
});
