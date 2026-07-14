import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BackButton from '../BackButton';

afterEach(cleanup);

describe('BackButton', () => {
  it('renders with default aria-label and ArrowLeft icon', () => {
    render(<BackButton onClick={() => {}} />);
    const button = screen.getByRole('button', { name: /go back/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-slate-900/60');
  });

  it('fires onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<BackButton onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('supports a custom aria-label', () => {
    render(<BackButton onClick={() => {}} aria-label="Back to Search" />);
    expect(screen.getByRole('button', { name: /back to search/i })).toBeInTheDocument();
  });

  it('respects disabled prop', () => {
    const handleClick = vi.fn();
    render(<BackButton onClick={handleClick} disabled />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('appends custom className', () => {
    render(<BackButton onClick={() => {}} className="-ml-1 absolute top-4 left-4" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('-ml-1');
    expect(button).toHaveClass('absolute');
  });
});
