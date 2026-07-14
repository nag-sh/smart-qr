import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MessageBanner from '../MessageBanner';

afterEach(cleanup);

describe('MessageBanner', () => {
  it('renders an error banner', () => {
    render(<MessageBanner type="error" message="Something failed" />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Something failed');
    expect(banner).toHaveClass('bg-red-500/10');
  });

  it('renders a success banner', () => {
    render(<MessageBanner type="success" message="Saved!" />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Saved!');
    expect(banner).toHaveClass('bg-emerald-500/10');
  });

  it('renders a warning banner', () => {
    render(<MessageBanner type="warning" message="Heads up" />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Heads up');
    expect(banner).toHaveClass('bg-amber-500/10');
  });

  it('renders ReactNode message content', () => {
    render(<MessageBanner type="error" message={<span data-testid="msg">Rich content</span>} />);
    expect(screen.getByTestId('msg')).toBeInTheDocument();
  });

  it('shows a close button when onClose is provided', () => {
    const handleClose = vi.fn();
    render(<MessageBanner type="error" message="Close me" onClose={handleClose} />);
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
