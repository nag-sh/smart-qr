// @vitest-environment jsdom
//
// Tests for Search filter drawer interaction.
// Reproduces the bug where only the first filter (Location: Garage) can be
// applied and all other filter-type choices are ignored or get converted
// back to the first location when ?filterLocation= is in the URL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../services/storage', () => ({
  getBins: vi.fn(),
  searchItems: vi.fn(),
}));

import { getBins, searchItems } from '../services/storage';
import Search from '../views/Search';

const mockBins = [
  { id: 'bin-1', name: 'Main Box', location: 'Garage', item_count: 5, created_at: '2024-01-01' },
  { id: 'bin-2', name: 'Toolbox', location: 'Workshop', item_count: 3, created_at: '2024-01-02' },
];

const mockItems = [
  {
    id: 'item-1',
    name: 'Screwdriver',
    bin_id: 'bin-1',
    bin_name: 'Main Box',
    bin_location: 'Garage',
    search_tags: ['tools', 'electronics'],
    description: 'A screwdriver',
    image_url: null,
    created_at: '2024-01-01',
  },
  {
    id: 'item-2',
    name: 'Hammer',
    bin_id: 'bin-2',
    bin_name: 'Toolbox',
    bin_location: 'Workshop',
    search_tags: ['tools'],
    description: 'A hammer',
    image_url: null,
    created_at: '2024-01-02',
  },
];

function renderSearch({ initialEntries = ['/'], modalTypes = [], onNavigate, onBack } = {}) {
  return render(
    React.createElement(MemoryRouter, { initialEntries },
      React.createElement(Search, {
        onNavigate: onNavigate || vi.fn(),
        onBack: onBack || vi.fn(),
        modalTypes,
      })
    )
  );
}

describe('Search filter drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBins.mockResolvedValue(mockBins);
    searchItems.mockResolvedValue(mockItems);
  });

  it('renders with default state', async () => {
    renderSearch();
    await waitFor(() => {
      expect(getBins).toHaveBeenCalledTimes(1);
      expect(searchItems).toHaveBeenCalledWith('');
    });
  });

  it('selects location from ?filterLocation= deep link on mount', async () => {
    renderSearch({ initialEntries: ['/?filterLocation=Garage'] });

    // The "Clear all" button appears when activeFilterCount > 0
    await waitFor(() => {
      expect(screen.getByText(/Clear all/)).toBeInTheDocument();
    });
  });

  it('toggles tag alongside existing location filter in drawer', async () => {
    const onNavigate = vi.fn();
    const onBack = vi.fn();

    renderSearch({
      initialEntries: ['/?filterLocation=Garage'],
      modalTypes: ['filters'],
      onNavigate,
      onBack,
    });

    // Wait for data to load
    await waitFor(() => {
      expect(getBins).toHaveBeenCalledTimes(1);
    });

    // The "Clear all" button should show count >= 1 (from Garage deep link)
    await waitFor(() => {
      const clearAll = screen.getByText(/Clear all/);
      expect(clearAll.textContent).toMatch(/\d+/);
    });

    // Click the "electronics" tag button in the drawer's Tags section
    const electronicsTag = screen.getByText('electronics');
    expect(electronicsTag).toBeInTheDocument();
    fireEvent.click(electronicsTag);

    // After clicking: "Clear all" should show count of 2
    // (Garage location + electronics tag)
    await waitFor(() => {
      const clearAll = screen.getByText(/Clear all/);
      expect(clearAll.textContent).toContain('2');
    });

    // The "Clear all" button confirms both filters are active
    const chips = screen.getAllByText(/Clear all/);
    expect(chips.length).toBeGreaterThanOrEqual(1);
  });
});
