import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, MapPin, QrCode, Plus, AlertCircle, RefreshCw, ArrowLeft, 
  Package, Printer, Edit, Trash2, Check, MoreHorizontal,
  FolderTree, LayoutGrid, List, Image as ImageIcon
} from 'lucide-react';
import { getBin, getBins, updateBin, deleteBin, batchManageItems } from '../services/storage';
import imageCompression from 'browser-image-compression';
import EntityList from '../components/EntityList';

export default function BinDetails({ binId, onNavigate, onPrintBin }) {
  const [bin, setBin] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 1. Edit Bin state
  const [editingBin, setEditingBin] = useState(false);
  const [editBinName, setEditBinName] = useState('');
  const [editBinLocation, setEditBinLocation] = useState('');
  const [editBinImageFile, setEditBinImageFile] = useState(null);
  const [editBinImagePreview, setEditBinImagePreview] = useState(null);
  const [savingBin, setSavingBin] = useState(false);
  const [allLocations, setAllLocations] = useState([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const binFileRef = useRef(null);

  // 2. Delete/Batch state
  const [deletingBin, setDeletingBin] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [allBins, setAllBins] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [batchAction, setBatchAction] = useState('reassign'); // 'reassign' | 'delete'
  const [batchTargetBin, setBatchTargetBin] = useState('');
  const [batchWorking, setBatchWorking] = useState(false);

  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef(null);

  const fetchLocations = async () => {
    try {
      const binsList = await getBins();
      const locs = Array.from(new Set(binsList.map(b => b.location).filter(Boolean)));
      setAllLocations(locs);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchBinDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getBin(binId);
      setBin(data.bin);
      setItems(data.items);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to retrieve bin details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (binId) {
      fetchBinDetails();
      fetchLocations();
    }
  }, [binId]);

  useEffect(() => {
    if (!showOverflowMenu) return;
    const handleClickOutside = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setShowOverflowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOverflowMenu]);

  // 5. Layout Modes & Infinite Scroll states
  const [layoutMode, setLayoutMode] = useState(() => {
    const saved = localStorage.getItem('view_mode_bin_items');
    const valid = ['thumbnail', 'detailed', 'gallery'];
    return valid.includes(saved) ? saved : 'thumbnail';
  }); // 'thumbnail' | 'detailed' | 'gallery'
  const [visibleItemsCount, setVisibleItemsCount] = useState(12);

  // Reset pagination when bin or layout changes
  useEffect(() => {
    setVisibleItemsCount(12);
  }, [binId, layoutMode]);

  useEffect(() => {
    localStorage.setItem('view_mode_bin_items', layoutMode);
  }, [layoutMode]);

  if (loading) {
    return (
      <div className="w-full max-w-md mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">Loading bin inventory...</p>
      </div>
    );
  }

  if (error || !bin) {
    return (
      <div className="w-full max-w-md mx-auto py-6 px-4 space-y-4">
        <button
          onClick={() => onNavigate('search')}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="glass-panel rounded-3xl p-6 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <div>
            <h3 className="font-semibold text-slate-200">Error Loading Bin</h3>
            <p className="text-xs text-slate-400 mt-1">{error || 'Bin not found.'}</p>
          </div>
        </div>
      </div>
    );
  }
  const handleStartEditBin = () => {
    setEditBinName(bin.name);
    setEditBinLocation(bin.location);
    setEditBinImageFile(null);
    setEditBinImagePreview(null);
    setEditingBin(true);
  };

  const handleProcessBinImage = async (file) => {
    try {
      const options = { maxSizeMB: 0.25, maxWidthOrHeight: 1024, useWebWorker: true };
      const compressed = await imageCompression(file, options);
      setEditBinImageFile(compressed);
      if (editBinImagePreview) URL.revokeObjectURL(editBinImagePreview);
      setEditBinImagePreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveBin = async () => {
    if (!editBinName.trim() || !editBinLocation.trim()) return;
    setSavingBin(true);
    try {
      const updated = await updateBin(bin.id, {
        name: editBinName.trim(),
        location: editBinLocation.trim()
      }, editBinImageFile);
      setBin(updated);
      setEditingBin(false);
      fetchBinDetails();
    } catch (err) {
      alert(err.message || 'Failed to update bin');
    } finally {
      setSavingBin(false);
    }
  };

  const handleDeleteBinPress = async () => {
    setDeletingBin(true);
    try {
      await deleteBin(bin.id);
      onNavigate('search');
    } catch (err) {
      if (err.blocked) {
        const binsList = await getBins();
        setAllBins(binsList.filter(b => b.id !== bin.id));
        setSelectedItems(new Set(items.map(i => i.id)));
        setBatchTargetBin(binsList.find(b => b.id !== bin.id)?.id || '');
        setShowBatchModal(true);
      } else {
        alert(err.message || 'Failed to delete bin');
      }
    } finally {
      setDeletingBin(false);
    }
  };

  const handleBatchApply = async () => {
    if (selectedItems.size === 0) return;
    setBatchWorking(true);
    try {
      await batchManageItems(bin.id, batchAction, Array.from(selectedItems), batchTargetBin);
      setShowBatchModal(false);
      // Try deleting now empty bin
      try {
        await deleteBin(bin.id);
        onNavigate('search');
      } catch {
        fetchBinDetails();
      }
    } catch (err) {
      alert(err.message || 'Failed batch action');
    } finally {
      setBatchWorking(false);
    }
  };

  return (
    <div className="w-full max-w-4xl min-w-[min(80vw,56rem)] mx-auto py-6 px-4 space-y-6">
      {/* Navigation header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('search')}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-2">
          <div className="relative" ref={overflowMenuRef}>
            <button
              onClick={() => setShowOverflowMenu(prev => !prev)}
              aria-label="More actions"
              aria-expanded={showOverflowMenu}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700/50"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showOverflowMenu && (
              <div className="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-50 py-1">
                <button
                  onClick={() => {
                    setShowOverflowMenu(false);
                    handleStartEditBin();
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Edit className="w-4 h-4 text-slate-300" /> Edit Bin
                </button>
                <button
                  onClick={() => {
                    setShowOverflowMenu(false);
                    handleDeleteBinPress();
                  }}
                  disabled={deletingBin}
                  className="w-full px-4 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-red-400 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  {deletingBin ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />} Delete Bin
                </button>
                <button
                  onClick={() => {
                    setShowOverflowMenu(false);
                    onPrintBin(bin.qr_id, bin.name);
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-purple-400" /> Print Label
                </button>
              </div>
            )}
          </div>
          <span className="text-xs px-3 py-2 rounded-lg bg-slate-800 border border-slate-700/50 text-slate-400 font-mono flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5 text-purple-400" /> {bin.qr_id.length > 16 ? bin.qr_id.slice(0, 16) + '...' : bin.qr_id}
          </span>
        </div>
      </div>

      {/* Bin Hero Banner Card */}
      {editingBin ? (
        <div className="glass-panel rounded-3xl p-6 shadow-2xl space-y-4 border border-purple-500/20 relative">
          <h2 className="text-sm font-bold text-slate-200">Edit Bin Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Photo</label>
              <input 
                type="file" 
                accept="image/*" 
                ref={binFileRef} 
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) handleProcessBinImage(file);
                }} 
                className="hidden" 
              />
              <div 
                onClick={() => binFileRef.current && binFileRef.current.click()}
                className="border-2 border-dashed border-slate-800 hover:border-purple-500/40 rounded-2xl aspect-video bg-slate-950/60 flex items-center justify-center cursor-pointer overflow-hidden relative group"
              >
                {editBinImagePreview || bin.image_url ? (
                  <img src={editBinImagePreview || bin.image_url} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center space-y-1">
                    <Plus className="w-6 h-6 text-slate-500 mx-auto" />
                    <span className="text-[10px] text-slate-500 block">Change Photo</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-xs text-white font-bold">
                  Upload Photo
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Bin Name</label>
                <input 
                  type="text" 
                  value={editBinName} 
                  onChange={(e) => setEditBinName(e.target.value)} 
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Location</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={editBinLocation} 
                    onChange={(e) => {
                      setEditBinLocation(e.target.value);
                      setShowLocationDropdown(true);
                    }}
                    onFocus={() => setShowLocationDropdown(true)}
                    className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100" 
                  />

                  {/* Click outside to close helper */}
                  {showLocationDropdown && allLocations.length > 5 && (
                    <div 
                      className="fixed inset-0 z-30" 
                      onClick={() => setShowLocationDropdown(false)}
                    />
                  )}

                  {/* Dropdown for excessive locations count (> 5) */}
                  {showLocationDropdown && allLocations.length > 5 && (
                    <div className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl z-40 max-h-48 overflow-y-auto">
                      {allLocations
                        .filter(loc => loc.toLowerCase().includes(editBinLocation.toLowerCase()))
                        .map(loc => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => {
                              setEditBinLocation(loc);
                              setShowLocationDropdown(false);
                            }}
                            className="w-full px-4 py-2.5 text-left text-xs text-slate-355 hover:bg-purple-600/25 hover:text-white transition-colors block"
                          >
                            {loc}
                          </button>
                        ))}
                      {allLocations.filter(loc => loc.toLowerCase().includes(editBinLocation.toLowerCase())).length === 0 && (
                        <div className="px-4 py-2.5 text-xs text-slate-500 italic">No matching locations. Keep typing to add new.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Inline clickable list for smaller locations count (<= 5) */}
                {allLocations.length > 0 && allLocations.length <= 5 && (
                  <div className="mt-2.5 space-y-1.5">
                    <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Saved Locations:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {allLocations.map(loc => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => setEditBinLocation(loc)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                            editBinLocation.toLowerCase() === loc.toLowerCase()
                              ? 'bg-purple-550/20 border-purple-500/40 text-purple-300'
                              : 'bg-slate-950/45 border-slate-850 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {loc}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={() => setEditingBin(false)}
              className="px-4 py-2 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveBin}
              disabled={savingBin || !editBinName.trim() || !editBinLocation.trim()}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs cursor-pointer shadow-lg shadow-purple-900/20 disabled:opacity-50"
            >
              {savingBin ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row">
          {/* Left side/top: Photo */}
          <div className="w-full md:w-1/3 aspect-video md:aspect-auto md:min-h-[160px] bg-slate-900 flex items-center justify-center relative border-b md:border-b-0 md:border-r border-slate-800/60">
            {bin.image_url ? (
              <img src={bin.image_url} alt={bin.name} className="w-full h-full object-cover" />
            ) : (
              <Box className="w-12 h-12 text-slate-700 stroke-1" />
            )}
          </div>

          {/* Right side/details */}
          <div className="p-6 flex-1 flex flex-col justify-between relative">
            <div className="space-y-3">
              <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                {bin.name}
              </h1>
              
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 bg-slate-950/45 border-slate-850 text-slate-400">
                  <MapPin className="w-3 h-3 text-pink-400 shrink-0" />
                  {bin.location}
                </span>
              </div>
            </div>

            <div className="mt-4 md:mt-0 pt-4 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-400">
              <span>Created {new Date(bin.created_at).toLocaleDateString()}</span>
              <span>{items.length} items cataloged</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Button: Add Item */}
      <button
        onClick={() => onNavigate('add-item', { binId: bin.id })}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-900/10 hover:shadow-purple-500/20 transition-all active:scale-98 cursor-pointer"
      >
        <Plus className="w-5 h-5" /> Add Item to Bin
      </button>

      {/* Items List */}
      <div>
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Items Inside This Bin ({items.length})
          </h2>

          {items.length > 0 && (
            <div className="flex bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 gap-1 shrink-0">
              <button
                onClick={() => setLayoutMode('thumbnail')}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  layoutMode === 'thumbnail'
                    ? 'bg-purple-655 text-white shadow shadow-purple-900/20'
                    : 'text-slate-505 hover:text-slate-300'
                }`}
                title="Thumbnail Grid"
              >
                <LayoutGrid className="w-3 h-3" />
              </button>
              <button
                onClick={() => setLayoutMode('detailed')}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  layoutMode === 'detailed'
                    ? 'bg-purple-655 text-white shadow shadow-purple-900/20'
                    : 'text-slate-550 hover:text-slate-300'
                }`}
                title="Detailed List"
              >
                <List className="w-3 h-3" />
              </button>
              <button
                onClick={() => setLayoutMode('gallery')}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  layoutMode === 'gallery'
                    ? 'bg-purple-655 text-white shadow shadow-purple-900/20'
                    : 'text-slate-550 hover:text-slate-300'
                }`}
                title="Gallery Mode"
              >
                <ImageIcon className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="glass-panel rounded-2xl py-12 text-center space-y-3">
            <Package className="w-10 h-10 text-slate-600 mx-auto stroke-1" />
            <div>
              <p className="text-sm font-semibold text-slate-300">This bin is currently empty</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                No items have been registered inside this bin yet. Tap the button above to snap a photo and add your first item.
              </p>
            </div>
          </div>
        ) : (
          <EntityList
            entities={items.slice(0, visibleItemsCount).map(item => ({
              type: 'item',
              id: item.id,
              name: item.name,
              description: item.description,
              image_url: item.image_url,
              bin_name: bin.name,
              bin_location: bin.location,
              search_tags: item.search_tags,
              created_at: item.created_at
            }))}
            layoutMode={layoutMode}
            onEntryClick={(entry) => onNavigate('item-details', { itemId: entry.id })}
            onLoadMore={() => setVisibleItemsCount(prev => prev + 12)}
            hasMore={items.length > visibleItemsCount}
            loading={false}
            emptyMessage="This bin is currently empty."
          />
        )}
      </div>

      {/* 1. BATCH MANAGE ITEMS MODAL */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-5 relative max-h-[90vh] flex flex-col justify-between">
            <button
              onClick={() => setShowBatchModal(false)}
              className="absolute top-4 left-4 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-purple-400" />
                Manage Bin Items
              </h2>
              <p className="text-xs text-slate-450 leading-relaxed">
                This bin has active items inside. Please choose how to handle them to proceed with deleting the bin container.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[150px] border border-slate-850 rounded-2xl p-3 space-y-2.5 bg-slate-950/40">
              <label className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-900/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedItems.size === items.length}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedItems(new Set(items.map(i => i.id)));
                    else setSelectedItems(new Set());
                  }}
                  className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-300">Select All Items ({items.length})</span>
              </label>

              <div className="h-px bg-slate-850"></div>

              {items.map(item => (
                <label key={item.id} className="flex items-center gap-2.5 p-2 rounded hover:bg-slate-900/60 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={() => {
                      const next = new Set(selectedItems);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      setSelectedItems(next);
                    }}
                    className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 truncate">{item.name}</span>
                </label>
              ))}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-3 bg-slate-900/50 border border-slate-800 rounded-xl">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input 
                      type="radio" 
                      name="batchAction" 
                      checked={batchAction === 'reassign'} 
                      onChange={() => setBatchAction('reassign')} 
                      className="text-purple-600 focus:ring-0 cursor-pointer" 
                    />
                    <span>Reassign to Bin</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input 
                      type="radio" 
                      name="batchAction" 
                      checked={batchAction === 'delete'} 
                      onChange={() => setBatchAction('delete')} 
                      className="text-purple-600 focus:ring-0 cursor-pointer" 
                    />
                    <span className="text-red-400">Delete Items</span>
                  </label>
                </div>

                {batchAction === 'reassign' && (
                  <select
                    value={batchTargetBin}
                    onChange={(e) => setBatchTargetBin(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none"
                  >
                    <option value="" disabled>Select Target Bin</option>
                    {allBins.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBatchApply}
                  disabled={batchWorking || selectedItems.size === 0 || (batchAction === 'reassign' && !batchTargetBin)}
                  className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {batchWorking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Apply Action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
