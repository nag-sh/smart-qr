import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Package, MapPin, Tag, RefreshCw, Eye, Edit, Trash2, Save, Plus, MoreHorizontal
} from 'lucide-react';
import { searchItems, getBin, getBins, updateItem, deleteItem, batchManageItems } from '../services/storage';
import imageCompression from 'browser-image-compression';

export default function ItemDetails({ onNavigate, itemId }) {
  const [item, setItem] = useState(null);
  const [bin, setBin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editVisibleText, setEditVisibleText] = useState('');
  const [editBinId, setEditBinId] = useState('');
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef(null);
  const [bins, setBins] = useState([]);
  const itemFileRef = useRef(null);

  // Load available bins once for the edit dropdown
  useEffect(() => {
    let mounted = true;
    const loadBins = async () => {
      try {
        const list = await getBins();
        if (mounted) setBins(list);
      } catch (err) {
        console.error('Failed to load bins:', err);
      }
    };
    loadBins();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!itemId) {
      setLoading(false);
      setError('Item ID is missing');
      return;
    }

    const fetchItem = async () => {
      setLoading(true);
      setError('');
      try {
        const items = await searchItems('');
        const found = items.find((i) => i.id === itemId);
        if (!found) {
          setError('Item not found');
          setItem(null);
          setBin(null);
          return;
        }
        setItem(found);

        if (found.bin_id) {
          try {
            const binData = await getBin(found.bin_id);
            setBin(binData.bin);
          } catch (binErr) {
            console.error('Failed to load parent bin:', binErr);
            setBin(null);
          }
        }
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load item details');
      } finally {
        setLoading(false);
      }
    };

    fetchItem();
  }, [itemId]);

  useEffect(() => {
    if (!showOverflowMenu) return;
    const handleClickOutside = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setShowOverflowMenu(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setShowOverflowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showOverflowMenu]);

  const startEdit = () => {
    if (!item) return;
    setEditName(item.name || '');
    setEditDescription(item.description || '');
    setEditTags((item.search_tags || []).join(', '));
    setEditVisibleText(item.visible_text || '');
    setEditBinId(item.bin_id || '');
    setEditImageFile(null);
    setEditImagePreview(null);
    setEditing(true);
    setError('');
  };

  const handleProcessImage = async (file) => {
    try {
      const options = { maxSizeMB: 0.25, maxWidthOrHeight: 1024, useWebWorker: true };
      const compressed = await imageCompression(file, options);
      setEditImageFile(compressed);
      if (editImagePreview) URL.revokeObjectURL(editImagePreview);
      setEditImagePreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error('Image compression failed:', err);
      setError('Image compression failed');
    }
  };

  const handleSave = async () => {
    if (!item || saving) return;
    setSaving(true);
    setError('');
    try {
      const fields = {
        name: editName.trim(),
        description: editDescription.trim(),
        search_tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
        visible_text: editVisibleText.trim(),
        bin_id: editBinId
      };

      await updateItem(item.id, fields, editImageFile);

      // updateItem does not persist bin_id, so move the item if the bin changed.
      if (item.bin_id && editBinId && editBinId !== item.bin_id) {
        await batchManageItems(item.bin_id, 'reassign', [item.id], editBinId);
      }

      // Refresh from source of truth
      const items = await searchItems('');
      const found = items.find((i) => i.id === itemId);
      if (!found) throw new Error('Item not found after update');
      setItem(found);

      if (found.bin_id) {
        try {
          const binData = await getBin(found.bin_id);
          setBin(binData.bin);
        } catch (binErr) {
          console.error('Failed to load parent bin:', binErr);
          setBin(null);
        }
      } else {
        setBin(null);
      }

      setEditing(false);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to update item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    setDeleting(true);
    try {
      await deleteItem(item.id);
      if (item.bin_id) {
        onNavigate('bin-details', { binId: item.bin_id });
      } else {
        onNavigate('search');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to delete item');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-md mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">Loading item details...</p>
      </div>
    );
  }

  if (error || !item) {
    return (
    <div className="w-full max-w-4xl min-w-[min(80vw,56rem)] mx-auto py-6 px-4 space-y-6">
        <button
          onClick={() => onNavigate('search')}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="glass-panel rounded-3xl p-8 text-center shadow-2xl border border-slate-800/80">
          <p className="text-slate-300 font-medium">{error || 'Item not found'}</p>
          <button
            onClick={() => onNavigate('search')}
            className="mt-4 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer transition-colors"
          >
            Return to Search
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl min-w-[min(80vw,56rem)] mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onNavigate('search')}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="relative" ref={overflowMenuRef}>
          <button
            onClick={() => setShowOverflowMenu(prev => !prev)}
            aria-label="More actions"
            aria-expanded={showOverflowMenu}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700/50"
            title="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showOverflowMenu && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-50 py-1">
              <button
                onClick={() => {
                  setShowOverflowMenu(false);
                  startEdit();
                }}
                className="w-full px-4 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Edit className="w-4 h-4 text-purple-400" /> Edit Item
              </button>
              <button
                onClick={() => {
                  setShowOverflowMenu(false);
                  handleDelete();
                }}
                disabled={deleting}
                className="w-full px-4 py-2.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-red-400 flex items-center gap-2 transition-colors cursor-pointer"
              >
                {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />} Delete Item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(false); }}
        >
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-800 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-sm font-bold text-slate-200">Edit Item</h2>
            </div>

            {error && (
              <p className="text-red-300 text-sm mb-4">{error}</p>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Search Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Visible Text
                </label>
                <textarea
                  value={editVisibleText}
                  onChange={(e) => setEditVisibleText(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Photo
                </label>
                <input
                  type="file"
                  accept="image/*"
                  ref={itemFileRef}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) handleProcessImage(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => itemFileRef.current && itemFileRef.current.click()}
                  className="border-2 border-dashed border-slate-800 hover:border-purple-500/40 rounded-2xl aspect-video bg-slate-950/60 flex items-center justify-center cursor-pointer overflow-hidden relative group"
                >
                  {editImagePreview || item.image_url ? (
                    <img
                      src={editImagePreview || item.image_url}
                      alt="Item preview"
                      className="w-full h-full object-cover"
                    />
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

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Bin
                </label>
                <select
                  value={editBinId}
                  onChange={(e) => setEditBinId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100"
                >
                  <option value="">No bin</option>
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} • {b.location}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-colors cursor-pointer border border-slate-700/50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editName.trim()}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-2"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item hero card */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row">
        {/* Left side/top: Photo */}
        <div className="w-full md:w-1/3 aspect-video md:aspect-auto md:min-h-[160px] bg-slate-900 flex items-center justify-center relative border-b md:border-b-0 md:border-r border-slate-800/60">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-12 h-12 text-slate-700 stroke-1" />
          )}
        </div>

        {/* Right side/details */}
        <div className="p-6 flex-1 flex flex-col justify-between relative">
          <div className="space-y-3">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              {item.name}
            </h1>

            {/* Clickable bin + location pill */}
            <button
              onClick={() => item.bin_id && onNavigate('bin-details', { binId: item.bin_id })}
              disabled={!item.bin_id}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                item.bin_id
                  ? 'bg-pink-500/10 border-pink-500/20 text-pink-300 hover:bg-pink-500/20 hover:border-pink-500/40'
                  : 'bg-slate-800/60 border-slate-800 text-slate-500 cursor-not-allowed'
              }`}
              title={bin ? `${bin.name} — ${bin.location}` : 'Bin location'}
            >
              <MapPin className="w-4 h-4 text-pink-400 shrink-0" />
              <span>{bin ? `${bin.name} • ${bin.location}` : item.bin_name || 'Unknown bin'}</span>
            </button>
          </div>

          <div className="mt-4 md:mt-0 pt-4 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-400">
            <span>Created {new Date(item.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <div className="glass-panel rounded-3xl p-6 shadow-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Description</h2>
          <p className="text-sm text-slate-300 leading-relaxed">{item.description}</p>
        </div>
      )}

      {/* Tags */}
      {item.search_tags && item.search_tags.length > 0 && (
        <div className="glass-panel rounded-3xl p-6 shadow-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-purple-400" /> Identified Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {item.search_tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300 flex items-center gap-1"
              >
                <Tag className="w-3 h-3 text-purple-400" />
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Visible text */}
      {item.visible_text && (
        <div className="glass-panel rounded-3xl p-6 shadow-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Eye className="w-3 h-3 text-pink-400" /> Visible Serial / Labels
          </h2>
          <pre className="bg-slate-950 p-4 rounded-2xl border border-slate-850 font-mono text-[11px] text-purple-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {item.visible_text}
          </pre>
        </div>
      )}
    </div>
  );
}
