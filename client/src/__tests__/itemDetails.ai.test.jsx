// @vitest-environment jsdom
//
// Tests for the AI Analysis feature in ItemDetails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../services/storage', () => ({
  searchItems: vi.fn(),
  getBin: vi.fn(),
  deleteItem: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('../services/gemini', () => ({
  analyzeItemImage: vi.fn(),
}));

vi.mock('../services/localImages', () => ({
  isImageRef: vi.fn((value) => typeof value === 'string' && value.startsWith('img_')),
  getImageBlob: vi.fn(),
  resolveImageUrl: vi.fn((value) => Promise.resolve(value)),
  releaseImageUrl: vi.fn(),
  storeImage: vi.fn(),
  deleteImage: vi.fn(),
  refToDataURL: vi.fn(),
  dataURLToBlob: vi.fn(),
  blobToDataURL: vi.fn(),
  planImagePath: vi.fn(),
  slugify: vi.fn(),
  EXT_FROM_TYPE: {},
}));

import { searchItems, getBin } from '../services/storage';
import { analyzeItemImage } from '../services/gemini';
import { getImageBlob } from '../services/localImages';
import ItemDetails from '../views/ItemDetails';

const mockItem = (overrides = {}) => ({
  id: 'item-ai-1',
  name: 'Hammer',
  bin_id: 'bin-1',
  bin_name: 'Toolbox',
  bin_location: 'Workshop',
  search_tags: ['tools'],
  description: 'A hammer',
  visible_text: '',
  image_url: 'img_hammer_123',
  created_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const mockBin = {
  id: 'bin-1',
  name: 'Toolbox',
  location: 'Workshop',
  item_count: 1,
  created_at: '2024-01-01T00:00:00.000Z',
};

function renderItemDetails(props = {}) {
  return render(
    React.createElement(ItemDetails, {
      itemId: 'item-ai-1',
      onBack: vi.fn(),
      onNavigate: vi.fn(),
      refreshNonce: 0,
      ...props,
    })
  );
}

async function openOverflowMenu() {
  const moreButton = screen.getByLabelText('More actions');
  fireEvent.click(moreButton);
  await waitFor(() => {
    expect(screen.getByText('AI Analysis')).toBeInTheDocument();
  });
}

describe('ItemDetails AI Analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    searchItems.mockResolvedValue([mockItem()]);
    getBin.mockResolvedValue({ bin: mockBin, items: [mockItem()] });
    getImageBlob.mockResolvedValue(new Blob(['fake-image'], { type: 'image/jpeg' }));
  });

  afterEach(() => {
    cleanup();
  });

  it('disables AI Analysis when no Gemini API key is stored', async () => {
    localStorage.removeItem('gemini_api_key');
    renderItemDetails();

    await waitFor(() => {
      expect(searchItems).toHaveBeenCalledTimes(1);
    });

    await openOverflowMenu();
    const aiButton = screen.getByText('AI Analysis').closest('button');
    expect(aiButton).toBeDisabled();
  });

  it('disables AI Analysis when the item has no image_url', async () => {
    localStorage.setItem('gemini_api_key', 'test-api-key');
    searchItems.mockResolvedValue([mockItem({ image_url: null })]);
    renderItemDetails();

    await waitFor(() => {
      expect(searchItems).toHaveBeenCalledTimes(1);
    });

    await openOverflowMenu();
    const aiButton = screen.getByText('AI Analysis').closest('button');
    expect(aiButton).toBeDisabled();
  });

  it('opens the review modal with a loading indicator after clicking AI Analysis', async () => {
    localStorage.setItem('gemini_api_key', 'test-api-key');
    let resolveAnalysis;
    const analysisPromise = new Promise((resolve) => {
      resolveAnalysis = resolve;
    });
    analyzeItemImage.mockReturnValue(analysisPromise);

    renderItemDetails();

    await waitFor(() => {
      expect(searchItems).toHaveBeenCalledTimes(1);
    });

    await openOverflowMenu();
    const aiButton = screen.getByText('AI Analysis').closest('button');
    expect(aiButton).not.toBeDisabled();

    fireEvent.click(aiButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI Analysis Review' })).toBeInTheDocument();
    });
    expect(screen.getByText('Analyzing image with Gemini...')).toBeInTheDocument();

    resolveAnalysis({
      title: 'Metal Hammer',
      description: 'A metal hammer with a wooden handle.',
      tags: ['tool', 'hammer'],
      colors: ['silver'],
      visible_text: '',
    });

    await waitFor(() => {
      expect(screen.getByText('Metal Hammer')).toBeInTheDocument();
    });
    expect(screen.getByText('A metal hammer with a wooden handle.')).toBeInTheDocument();
  });
});
