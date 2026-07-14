import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, MapPin, QrCode, Box, Package, Layers, Filter as FilterIcon, Tag, Trash2, Move, RefreshCw, Check, X, Settings as SettingsIcon } from 'lucide-react';
import { getBins, searchItems, batchDeleteBins, batchUpdateBinLocations, batchDeleteItems, batchMoveItems } from '../services/storage';
import EntityList from '../components/EntityList';
import BackButton from '../components/BackButton';
import LayoutModeToggle from '../components/LayoutModeToggle';

export default function Search({ onNavigate, onBack, modalTypes }) {
  const [query, setQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState(() => {
    const saved = localStorage.getItem('view_mode_search');
    const valid = ['thumbnail', 'detailed', 'gallery'];
    return valid.includes(saved) ? saved : 'thumbnail';
  }); // 'thumbnail' | 'detailed' | 'gallery'

  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [moveTargetBin, setMoveTargetBin] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [batchWorking, setBatchWorking] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState(new Set());
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [selectedBins, setSelectedBins] = useState(new Set());
  const [selectedHasFields, setSelectedHasFields] = useState(new Set());
  const [searchParams] = useSearchParams();
  const searchViewRef = useRef(null);

  useEffect(() => {
    document.querySelectorAll('[data-search-view]').forEach((root) => {
      if (root !== searchViewRef.current) {
        root.parentElement?.remove();
      }
    });
  }, []);

  const activeFilterCount = selectedLocations.size + selectedTags.size + selectedBins.size + selectedHasFields.size;

  const toggleInSet = (set, value, setter) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const clearFilters = () => {
    setSelectedLocations(new Set());
    setSelectedTags(new Set());
    setSelectedBins(new Set());
    setSelectedHasFields(new Set());
  };

  const isolateFilter = (type, value) => {
    if (type === 'locations') {
      setSelectedLocations(new Set([value]));
      setSelectedTags(new Set());
      setSelectedBins(new Set());
      setSelectedHasFields(new Set());
    } else if (type === 'tags') {
      setSelectedTags(new Set([value]));
      setSelectedLocations(new Set());
      setSelectedBins(new Set());
      setSelectedHasFields(new Set());
    } else if (type === 'bins') {
      setSelectedBins(new Set([value]));
      setSelectedLocations(new Set());
      setSelectedTags(new Set());
      setSelectedHasFields(new Set());
    } else if (type === 'hasFields') {
      setSelectedHasFields(new Set([value]));
      setSelectedLocations(new Set());
      setSelectedTags(new Set());
      setSelectedBins(new Set());
    }
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('search_filters'));
      if (saved && typeof saved === 'object' && saved !== null) {
        if (Array.isArray(saved.locations)) setSelectedLocations(new Set(saved.locations));
        if (Array.isArray(saved.tags)) setSelectedTags(new Set(saved.tags));
        if (Array.isArray(saved.bins)) setSelectedBins(new Set(saved.bins));
        if (Array.isArray(saved.hasFields)) setSelectedHasFields(new Set(saved.hasFields));
      }
    } catch (err) {
      console.warn('Failed to parse saved search filters:', err);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('search_filters', JSON.stringify({
      locations: Array.from(selectedLocations),
      tags: Array.from(selectedTags),
      bins: Array.from(selectedBins),
      hasFields: Array.from(selectedHasFields)
    }));
  }, [selectedLocations, selectedTags, selectedBins, selectedHasFields]);

  const filterLocation = searchParams.get('filterLocation');

  useEffect(() => {
    if (filterLocation) {
      setSelectedLocations(new Set([filterLocation]));
      setSelectedTags(new Set());
      setSelectedBins(new Set());
      setSelectedHasFields(new Set());
    }
  }, [filterLocation]);

  // Bins state
  const [bins, setBins] = useState([]);
  const [binsLoading, setBinsLoading] = useState(true);

  // Items state
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);

  const [error, setError] = useState('');

  // Unified pagination state
  const [visibleCount, setVisibleCount] = useState(12);

  const debounceTimerRef = useRef(null);

  const fetchBins = async () => {
    try {
      setBinsLoading(true);
      setError('');
      const binsList = await getBins();
      setBins(binsList);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load bins list');
    } finally {
      setBinsLoading(false);
    }
  };

  const fetchItems = async (searchQuery) => {
    try {
      setItemsLoading(true);
      setError('');
      const itemsList = await searchItems(searchQuery);
      setItems(itemsList);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to search items');
    } finally {
      setItemsLoading(false);
    }
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchBins();
    fetchItems('');
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Reset pagination when filter criteria or layout change
  useEffect(() => {
    setVisibleCount(12);
  }, [query, layoutMode, selectedLocations, selectedTags, selectedBins, selectedHasFields]);

  // Handle search input changes
  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchItems(val);
    }, 250);
  };

  // Client-side filtering of bins for rapid keystroke filtering
  const filteredBins = useMemo(() => bins.filter(bin =>
    bin.name.toLowerCase().includes(query.toLowerCase()) ||
    bin.location.toLowerCase().includes(query.toLowerCase())
  ), [bins, query]);

  const allLocations = useMemo(() => {
    const locs = new Set();
    bins.forEach(b => { if (b.location) locs.add(b.location); });
    items.forEach(i => { if (i.bin_location) locs.add(i.bin_location); });
    return Array.from(locs).sort((a, b) => a.localeCompare(b));
  }, [bins, items]);

  const allTags = useMemo(() => {
    const counts = new Map();
    items.forEach(i => {
      (i.search_tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [items]);

  const allBins = useMemo(() => [...bins].sort((a, b) => a.name.localeCompare(b.name)), [bins]);

  const unifiedEntities = useMemo(() => {
    const binEntries = filteredBins.map(bin => ({
      ...bin,
      type: 'bin',
    }));

    const itemEntries = items.map(item => ({
      ...item,
      type: 'item',
      location: item.bin_location,
      search_tags: item.search_tags || [],
    }));

    return [...binEntries, ...itemEntries];
  }, [filteredBins, items]);

  const filteredEntities = useMemo(() => {
    return unifiedEntities.filter(entry => {
      if (selectedLocations.size > 0) {
        const loc = entry.type === 'bin' ? entry.location : entry.bin_location;
        const entryLoc = (loc || '').toLowerCase();
        if (!Array.from(selectedLocations).some(sl => sl.toLowerCase() === entryLoc)) return false;
      }

      if (selectedTags.size > 0) {
        const tags = entry.search_tags || [];
        if (!Array.from(selectedTags).some(st => tags.includes(st))) return false;
      }

      if (selectedBins.size > 0) {
        const matches = entry.type === 'bin'
          ? selectedBins.has(entry.id)
          : selectedBins.has(entry.bin_id);
        if (!matches) return false;
      }

      if (selectedHasFields.size > 0) {
        for (const field of selectedHasFields) {
          if (field === 'image' && !entry.image_url) return false;
          if (field === 'description' && (entry.type !== 'item' || !entry.description)) return false;
          if (field === 'location' && (entry.type !== 'bin' || !entry.location)) return false;
          if (field === 'bin' && (entry.type !== 'item' || !entry.bin_id)) return false;
        }
      }

      return true;
    });
  }, [unifiedEntities, selectedLocations, selectedTags, selectedBins, selectedHasFields]);

  const sortedEntities = useMemo(() => {
    if (layoutMode !== 'gallery') return filteredEntities;
    return [...filteredEntities].sort((a, b) => {
      const aHasImage = a.image_url ? 1 : 0;
      const bHasImage = b.image_url ? 1 : 0;
      return bHasImage - aHasImage;
    });
  }, [filteredEntities, layoutMode]);

  const paginatedEntities = sortedEntities.slice(0, visibleCount);
  const hasMore = visibleCount < sortedEntities.length;

  const displayEntities = useMemo(() => {
    if (!modalTypes.includes('filters')) return paginatedEntities;
    return paginatedEntities.map((entry) =>
      entry.type === 'item' ? { ...entry, search_tags: [] } : entry
    );
  }, [paginatedEntities, modalTypes]);

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + 12);
  };

  const handleEntryClick = (entry) => {
    if (entry.type === 'bin') {
      onNavigate('bin-details', { binId: entry.id });
    } else {
      onNavigate('item-details', { itemId: entry.id });
    }
  };

  const toggleManageMode = () => {
    setManageMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  };

  const handleLongPress = useCallback((entry) => {
    setSelectedIds(new Set([entry.id]));
    setManageMode(true);
  }, []);

  const toggleSelected = (entry, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entry.id);
      else next.delete(entry.id);
      return next;
    });
  };

  const selectedEntries = useMemo(() => filteredEntities.filter((e) => selectedIds.has(e.id)), [filteredEntities, selectedIds]);
  const selectedBinEntries = useMemo(() => selectedEntries.filter((e) => e.type === 'bin'), [selectedEntries]);
  const selectedItemEntries = useMemo(() => selectedEntries.filter((e) => e.type === 'item'), [selectedEntries]);
  const isMixedSelection = selectedBinEntries.length > 0 && selectedItemEntries.length > 0;

  const refreshAfterBatch = async () => {
    await fetchBins();
    await fetchItems(query);
  };

  const handleDeleteSelectedItems = async () => {
    if (selectedItemEntries.length === 0) return;
    if (!window.confirm(`Delete ${selectedItemEntries.length} item(s)?`)) return;
    setBatchWorking(true);
    try {
      await batchDeleteItems(selectedItemEntries.map((e) => e.id));
      await refreshAfterBatch();
      setSelectedIds(new Set());
      setMoveTargetBin('');
    } catch (err) {
      alert(err.message || 'Failed to delete items');
    } finally {
      setBatchWorking(false);
    }
  };

  const handleDeleteSelectedBins = async () => {
    if (selectedBinEntries.length === 0) return;
    if (!window.confirm(`Delete ${selectedBinEntries.length} bin(s)? Non-empty bins will be blocked.`)) return;
    setBatchWorking(true);
    try {
      await batchDeleteBins(selectedBinEntries.map((e) => e.id));
      await refreshAfterBatch();
      setSelectedIds(new Set());
      setNewLocation('');
    } catch (err) {
      if (err.blocked) {
        alert(err.message || 'Cannot delete bin: it contains items. Manage them first.');
      } else {
        alert(err.message || 'Failed to delete bins');
      }
    } finally {
      setBatchWorking(false);
    }
  };

  const handleMoveSelectedItems = async () => {
    if (selectedItemEntries.length === 0 || !moveTargetBin) return;
    setBatchWorking(true);
    try {
      await batchMoveItems(selectedItemEntries.map((e) => e.id), moveTargetBin);
      await refreshAfterBatch();
      setSelectedIds(new Set());
      setMoveTargetBin('');
    } catch (err) {
      alert(err.message || 'Failed to move items');
    } finally {
      setBatchWorking(false);
    }
  };

  const handleChangeSelectedBinLocations = async () => {
    if (selectedBinEntries.length === 0 || !newLocation.trim()) return;
    setBatchWorking(true);
    try {
      await batchUpdateBinLocations(selectedBinEntries.map((e) => e.id), newLocation.trim());
      await refreshAfterBatch();
      setSelectedIds(new Set());
      setNewLocation('');
    } catch (err) {
      alert(err.message || 'Failed to update locations');
    } finally {
      setBatchWorking(false);
    }
  };

  return (
    <div ref={searchViewRef} data-search-view className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Compact Brand Header */}
      <div className="py-1">
        <h1 className="text-xl font-bold tracking-tight leading-tight">
          Smart <span className="text-gradient">QR Inventory</span>
        </h1>
      </div>

      {/* Unified Search Bar & Quick Scan */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search bins, items, tags, locations..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl glass-input text-sm text-slate-100 placeholder-slate-455"
          />
        </div>
        <button
          onClick={() => onNavigate('scanner')}
          className="p-3.5 rounded-2xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 text-purple-300 hover:text-white transition-all cursor-pointer flex items-center justify-center shrink-0"
          title="Scan QR Code"
        >
          <QrCode className="w-5 h-5" />
        </button>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from(selectedLocations).map((loc) => (
            <span
              key={`loc-${loc}`}
              onClick={() => isolateFilter('locations', loc)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold bg-purple-500/20 border-purple-500/40 text-purple-300 cursor-pointer hover:bg-purple-500/30 transition-colors"
            >
              <MapPin className="w-3 h-3 text-pink-400 shrink-0" />
              {loc}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleInSet(selectedLocations, loc, setSelectedLocations);
                }}
                className="ml-0.5 p-0.5 rounded hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors cursor-pointer"
                aria-label={`Remove location ${loc}`}
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {Array.from(selectedTags).map((tag) => (
            <span
              key={`tag-${tag}`}
              onClick={() => isolateFilter('tags', tag)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold bg-purple-500/20 border-purple-500/40 text-purple-300 cursor-pointer hover:bg-purple-500/30 transition-colors"
            >
              <Tag className="w-3 h-3 text-purple-400 shrink-0" />
              {tag}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleInSet(selectedTags, tag, setSelectedTags);
                }}
                className="ml-0.5 p-0.5 rounded hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors cursor-pointer"
                aria-label={`Remove tag ${tag}`}
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {Array.from(selectedBins).map((binId) => {
            const bin = allBins.find((b) => b.id === binId);
            return (
              <span
                key={`bin-${binId}`}
                onClick={() => isolateFilter('bins', binId)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold bg-purple-500/20 border-purple-500/40 text-purple-300 cursor-pointer hover:bg-purple-500/30 transition-colors"
              >
                <Box className="w-3 h-3 text-slate-400 shrink-0" />
                {bin ? bin.name : binId}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleInSet(selectedBins, binId, setSelectedBins);
                  }}
                  className="ml-0.5 p-0.5 rounded hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors cursor-pointer"
                  aria-label={`Remove bin ${bin ? bin.name : binId}`}
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          {Array.from(selectedHasFields).map((field) => (
            <span
              key={`field-${field}`}
              onClick={() => isolateFilter('hasFields', field)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold bg-purple-500/20 border-purple-500/40 text-purple-300 cursor-pointer hover:bg-purple-500/30 transition-colors"
            >
              {field.charAt(0).toUpperCase() + field.slice(1)}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleInSet(selectedHasFields, field, setSelectedHasFields);
                }}
                className="ml-0.5 p-0.5 rounded hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 transition-colors cursor-pointer"
                aria-label={`Remove field ${field}`}
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer bg-slate-950/45 border-slate-850 text-slate-400 hover:text-slate-200 hover:border-slate-700"
          >
            Clear all ({activeFilterCount})
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <LayoutModeToggle
          mode={layoutMode}
          onChange={setLayoutMode}
          storageKey="view_mode_search"
          variant="search"
        />

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate('filters')}
            className={`relative p-2.5 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 bg-slate-900/60 border border-slate-800/80 ${
              modalTypes.includes('filters') || activeFilterCount > 0
                ? 'bg-purple-600 text-white shadow shadow-purple-950/20'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Filters"
            aria-label="Filters"
          >
            <FilterIcon className="w-5 h-5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-pink-500 text-[8px] font-bold text-white shadow-sm">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="p-2.5 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 bg-slate-900/60 border border-slate-800/80 text-slate-500 hover:text-slate-300"
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/25 rounded-2xl text-center text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Unified Entity List */}
      <EntityList
        entities={displayEntities}
        layoutMode={layoutMode}
        manageMode={manageMode}
        selectedIds={selectedIds}
        onSelectToggle={toggleSelected}
        onEntryClick={handleEntryClick}
        onLongPress={handleLongPress}
        onLoadMore={handleLoadMore}
        hasMore={hasMore}
        loading={binsLoading || itemsLoading}
        emptyMessage="No bins or items found"
        typeLabels={{ bin: 'Bin', item: 'Item' }}
        onLocationClick={(loc) => onNavigate('search', { location: loc })}
      />

      {/* Manage Mode Floating Action Bar */}
      {manageMode && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[95%] max-w-4xl z-30 glass-panel rounded-2xl p-4 shadow-2xl border border-slate-800/60 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors cursor-pointer"
              >
                Clear
              </button>
              <button
                onClick={toggleManageMode}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 transition-colors cursor-pointer"
                title="Cancel manage mode"
                aria-label="Cancel manage mode"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {isMixedSelection && (
            <div className="text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              Select only bins or only items
            </div>
          )}

          {!isMixedSelection && selectedIds.size === 0 && (
            <div className="text-xs text-slate-450 py-1">
              Select bins or items to batch edit.
            </div>
          )}

          {!isMixedSelection && selectedItemEntries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDeleteSelectedItems}
                disabled={batchWorking}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 disabled:opacity-50 text-[11px] font-bold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete {selectedItemEntries.length} item(s)
              </button>
              <div className="flex items-center gap-1.5">
                <select
                  value={moveTargetBin}
                  onChange={(e) => setMoveTargetBin(e.target.value)}
                  disabled={batchWorking}
                  className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-2.5 py-2 focus:outline-none cursor-pointer disabled:opacity-50"
                >
                  <option value="">Move to bin...</option>
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleMoveSelectedItems}
                  disabled={batchWorking || !moveTargetBin}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-bold transition-colors cursor-pointer"
                >
                  {batchWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Move className="w-3.5 h-3.5" />}
                  Move
                </button>
              </div>
            </div>
          )}

          {!isMixedSelection && selectedBinEntries.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDeleteSelectedBins}
                disabled={batchWorking}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 disabled:opacity-50 text-[11px] font-bold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete {selectedBinEntries.length} bin(s)
              </button>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  disabled={batchWorking}
                  placeholder="New location..."
                  className="glass-input px-3 py-2 rounded-xl text-xs w-40 disabled:opacity-50"
                />
                <button
                  onClick={handleChangeSelectedBinLocations}
                  disabled={batchWorking || !newLocation.trim()}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-bold transition-colors cursor-pointer"
                >
                  {batchWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Set Location
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Add Modal */}
      {modalTypes.includes('quick-add') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/30 backdrop-blur-md"
          onClick={onBack}
          role="dialog"
          aria-modal="true"
          aria-label="Quick Add"
        >
          <div
            className="glass-panel-modal w-full max-w-sm rounded-3xl p-6 relative space-y-5 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <BackButton
                onClick={onBack}
                className="-ml-1"
                aria-label="Back to Search"
              />
              <div>
                <h2 className="text-base font-bold text-slate-200">Quick Add</h2>
                <p className="text-xs text-slate-400">Choose what to create next.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => {
                  onNavigate('create-bin');
                }}
                className="flex items-center gap-3 p-4 rounded-2xl glass-card border border-slate-800/60 hover:border-purple-500/30 hover:bg-slate-900/60 transition-all cursor-pointer text-left group"
                aria-label="Register Bin"
              >
                <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400 group-hover:scale-110 transition-transform">
                  <Box className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-sm font-bold text-slate-200 group-hover:text-purple-300">Register Bin</span>
                  <span className="block text-[10px] text-slate-500">Create a new storage bin</span>
                </div>
              </button>

              <button
                onClick={() => {
                  onNavigate('add-item');
                }}
                className="flex items-center gap-3 p-4 rounded-2xl glass-card border border-slate-800/60 hover:border-pink-500/30 hover:bg-slate-900/60 transition-all cursor-pointer text-left group"
                aria-label="Add Item"
              >
                <div className="p-2 bg-pink-500/10 rounded-xl text-pink-400 group-hover:scale-110 transition-transform">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-sm font-bold text-slate-200 group-hover:text-pink-300">Add Item</span>
                  <span className="block text-[10px] text-slate-500">Add an item to a bin</span>
                </div>
              </button>

              <button
                onClick={() => {
                  onNavigate('print-randomized');
                }}
                className="flex items-center gap-3 p-4 rounded-2xl glass-card border border-slate-800/60 hover:border-cyan-500/30 hover:bg-slate-900/60 transition-all cursor-pointer text-left group"
                aria-label="Print Randomized QR Codes"
              >
                <div className="p-2 bg-cyan-500/10 rounded-xl text-cyan-400 group-hover:scale-110 transition-transform">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-sm font-bold text-slate-200 group-hover:text-cyan-300">Print Randomized QR Codes</span>
                  <span className="block text-[10px] text-slate-500">Bulk print blank QR labels</span>
                </div>
              </button>

              <button
                onClick={() => {
                  onNavigate('multi-add');
                }}
                className="flex items-center gap-3 p-4 rounded-2xl glass-card border border-slate-800/60 hover:border-amber-500/30 hover:bg-slate-900/60 transition-all cursor-pointer text-left group"
                aria-label="Multi-add Items"
              >
                <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400 group-hover:scale-110 transition-transform">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-sm font-bold text-slate-200 group-hover:text-amber-300">Multi-add Items</span>
                  <span className="block text-[10px] text-slate-500">Bulk-capture many items at once</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Filter Drawer */}
      {modalTypes.includes('filters') && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm"
          onClick={onBack}
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
        >
          <div
            className="fixed inset-y-0 right-0 z-50 w-full max-w-sm glass-panel border-l border-slate-800 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out translate-x-0 pt-[max(env(safe-area-inset-top),1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-800/60 shrink-0">
              <BackButton
                onClick={onBack}
                aria-label="Back to Search"
              />
              <h2 className="text-base font-bold text-slate-200">Filters</h2>
              <button
                onClick={onBack}
                className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                title="Close filters"
                aria-label="Close filters"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-6">
              {allLocations.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <MapPin className="w-3 h-3 text-pink-400" />
                    Locations
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allLocations.map(loc => {
                      const selected = selectedLocations.has(loc);
                      return (
                        <button
                          key={loc}
                          onClick={() => toggleInSet(selectedLocations, loc, setSelectedLocations)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 ${
                            selected
                              ? 'bg-pink-500/20 border-pink-500/40 text-pink-300 shadow-md shadow-pink-950/20'
                              : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <MapPin className="w-3 h-3 text-pink-400 shrink-0" />
                          {loc}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {allTags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <Tag className="w-3 h-3 text-purple-400" />
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(tag => {
                      const selected = selectedTags.has(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleInSet(selectedTags, tag, setSelectedTags)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 ${
                            selected
                              ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 shadow-md shadow-purple-950/20'
                              : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Tag className="w-3 h-3 text-purple-400 shrink-0" />
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {allBins.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <Box className="w-3 h-3 text-slate-400" />
                    Bins
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allBins.map(bin => {
                      const selected = selectedBins.has(bin.id);
                      return (
                        <button
                          key={bin.id}
                          onClick={() => toggleInSet(selectedBins, bin.id, setSelectedBins)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 ${
                            selected
                              ? 'bg-purple-600/20 border-purple-500/40 text-purple-300 shadow-md shadow-purple-950/20'
                              : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Box className="w-3 h-3 text-purple-400 shrink-0" />
                          {bin.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Has fields
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['description', 'image', 'location', 'bin'].map(field => {
                    const selected = selectedHasFields.has(field);
                    return (
                      <button
                        key={field}
                        onClick={() => toggleInSet(selectedHasFields, field, setSelectedHasFields)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer active:scale-95 capitalize ${
                          selected
                            ? 'bg-pink-500/20 border-pink-500/40 text-pink-300 shadow-md shadow-pink-950/20'
                            : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {field}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="w-full py-2 rounded-xl border border-slate-800 bg-slate-950/45 text-xs font-bold text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all cursor-pointer"
                >
                  Clear filters ({activeFilterCount})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
