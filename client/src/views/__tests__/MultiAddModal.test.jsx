// @vitest-environment jsdom
//
// Integration tests for MultiAddModal bulk photo-entry modal.
// Mocks all external dependencies so the tests run deterministically offline.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { act } from 'react';
import MultiAddModal from '../MultiAddModal';
import { analyzeItemImage } from '../../services/gemini';
import {
  createItem,
  deleteItem,
  batchDeleteItems,
} from '../../services/storage';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockAnalyze = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    title: 'Box',
    description: 'd',
    tags: ['red', 'blue'],
    colors: ['green'],
    visible_text: '',
  }),
);

const mockCompress = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new File([], 'c.jpg', { type: 'image/jpeg' })),
);

const mockCreateItem = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'item-1', name: 'Test' }),
);

const mockDeleteItem = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBatchDelete = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetBins = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    { id: 'bin-A', name: 'Tools', location: 'Garage' },
    { id: 'bin-B', name: 'Kitchen', location: 'Pantry' },
  ]),
);

vi.mock('../../components/InlineCamera', () => ({
  default: function InlineCamera({ onCapture }) {
    return (
      <button
        type="button"
        data-testid="capture"
        onClick={() => onCapture(new File([], 'shot.jpg', { type: 'image/jpeg' }))}
      >
        Capture
      </button>
    );
  },
}));

vi.mock('../../components/MessageBanner', () => ({
  default: function MessageBanner({ message }) {
    return <div data-testid="message-banner">{message}</div>;
  },
}));

vi.mock('../../utils/imageCompression', () => ({
  compressImage: mockCompress,
}));

vi.mock('../../services/gemini', () => ({
  analyzeItemImage: mockAnalyze,
}));

vi.mock('../../services/storage', () => ({
  createItem: mockCreateItem,
  deleteItem: mockDeleteItem,
  batchDeleteItems: mockBatchDelete,
  getBins: mockGetBins,
}));

// ─── Globals / Stubs ───────────────────────────────────────────────────────

let originalIntersectionObserver;
let uuidCounter = 0;
let urlCounter = 0;

beforeAll(() => {
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this._callback = callback;
    }
    observe(target) {
      this._callback([{ isIntersecting: true, target }]);
    }
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  globalThis.IntersectionObserver = originalIntersectionObserver;
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();

  mockAnalyze.mockResolvedValue({
    title: 'Box',
    description: 'd',
    tags: ['red', 'blue'],
    colors: ['green'],
    visible_text: '',
  });
  mockCompress.mockResolvedValue(new File([], 'c.jpg', { type: 'image/jpeg' }));
  mockCreateItem.mockResolvedValue({ id: 'item-1', name: 'Test' });
  mockDeleteItem.mockResolvedValue(undefined);
  mockBatchDelete.mockResolvedValue(undefined);
  mockGetBins.mockResolvedValue([
    { id: 'bin-A', name: 'Tools', location: 'Garage' },
    { id: 'bin-B', name: 'Kitchen', location: 'Pantry' },
  ]);

  uuidCounter = 0;
  urlCounter = 0;

  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockImplementation(() => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    }),
  });

  URL.createObjectURL = vi.fn().mockImplementation(() => {
    urlCounter += 1;
    return `blob://preview-${urlCounter}`;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MultiAddModal', () => {
  it('(a) renders with an API key set and accepts capture', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    expect(screen.queryByText(/No Gemini API Key set/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('capture')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('capture'));

    await waitFor(() => {
      expect(screen.getByText(/Roll \(1\)/i)).toBeInTheDocument();
    });
  });

  it('(b) warns when no API key is set and opens settings', async () => {
    const onNavigate = vi.fn();

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={onNavigate}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    expect(screen.getByText(/No Gemini API Key set/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('(c) captures a photo and creates a success card', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));

    await waitFor(() => expect(analyzeItemImage).toHaveBeenCalled());
    await waitFor(() => expect(createItem).toHaveBeenCalled());

    expect(createItem).toHaveBeenCalledWith(
      'bin-1',
      'Box',
      'd',
      ['red', 'blue', 'green'],
      '',
      expect.any(File),
    );
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('(d) retries analysis twice and succeeds on the third attempt', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    analyzeItemImage
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        title: 'Box',
        description: 'd',
        tags: ['red'],
        colors: ['blue'],
        visible_text: '',
      });

    vi.useFakeTimers();

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(analyzeItemImage).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Test')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('(e) marks the card as failed on a non-retryable error', async () => {
    localStorage.setItem('gemini_api_key', 'k');
    analyzeItemImage.mockRejectedValue(new Error('Missing API key'));

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));

    await waitFor(() => {
      expect(screen.getByText('Missing API key')).toBeInTheDocument();
    });
    expect(analyzeItemImage).toHaveBeenCalledTimes(1);
  });

  it('(f) removes a success card and deletes the stored item', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Remove'));
    await waitFor(() => {
      expect(screen.queryByText('Test')).not.toBeInTheDocument();
    });

    expect(deleteItem).toHaveBeenCalledWith('item-1');
  });

  it('(g) clears all success cards and batch deletes them', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    createItem
      .mockResolvedValueOnce({ id: 'item-1', name: 'Test' })
      .mockResolvedValueOnce({ id: 'item-2', name: 'Test' });

    render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('capture'));
    await waitFor(() => expect(screen.getAllByText('Test')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    await waitFor(() => {
      expect(screen.queryByText('Test')).not.toBeInTheDocument();
    });

    expect(batchDeleteItems).toHaveBeenCalledWith(['item-1', 'item-2']);
  });

  it('shows a bin picker when opened without a binId and proceeds after selection', async () => {
    render(
      <MultiAddModal
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    expect(screen.getByText(/Choose a bin/i)).toBeInTheDocument();

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'bin-A' } });

    await waitFor(() => expect(screen.getByTestId('capture')).toBeInTheDocument());
  });

  it('keeps the roll thumbnail visible after AI processing completes', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    const { container } = render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));

    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());

    // The captured picture must still be shown, not vanish once it succeeds.
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('blob://preview-1');
  });

  it('continues processing in the background when the modal is closed before completion', async () => {
    localStorage.setItem('gemini_api_key', 'k');

    const { unmount } = render(
      <MultiAddModal
        binId="bin-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        refreshNonce={0}
      />,
    );

    fireEvent.click(screen.getByTestId('capture'));
    // Close the modal before the capture finishes processing.
    unmount();

    // The in-flight capture must still be created and added to the bin.
    await waitFor(() => expect(createItem).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledWith(
      'bin-1',
      'Box',
      'd',
      ['red', 'blue', 'green'],
      '',
      expect.any(File),
    );
  });
});
