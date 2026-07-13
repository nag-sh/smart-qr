import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Save, Plus } from 'lucide-react';
import { searchItems, getBins, updateItem, batchManageItems } from '../services/storage';
import imageCompression from 'browser-image-compression';

// Top-level stacked modal for editing an item. Rendered by App's modal stack
// (not nested inside ItemDetails) so it appears as a clean, full modal layer.
export default function EditItem({ itemId, onBack, refreshNonce }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editVisibleText, setEditVisibleText] = useState('');
  const [editBinId, setEditBinId] = useState('');
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
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
          return;
        }
        setItem(found);
        setEditName(found.name || '');
        setEditDescription(found.description || '');
        setEditTags((found.search_tags || []).join(', '));
        setEditVisibleText(found.visible_text || '');
        setEditBinId(found.bin_id || '');
        setEditImageFile(null);
        setEditImagePreview(null);
        setError('');
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load item');
      } finally {
        setLoading(false);
      }
    };

    fetchItem();
  }, [itemId, refreshNonce]);

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

      // Return to the parent modal (item-details), which refreshes via refreshNonce.
      onBack();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to update item');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">Loading item...</p>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="w-full max-w-2xl mx-auto py-6 px-4 space-y-6">
        <div className="glass-panel rounded-3xl p-8 text-center shadow-2xl border border-slate-800/80">
          <p className="text-slate-300 font-medium">{error || 'Item not found'}</p>
          <button
            onClick={() => onBack()}
            className="mt-4 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-4 space-y-4">
      <h2 className="text-lg font-bold text-slate-100">Edit Item</h2>

      {error && (
        <p className="text-red-300 text-sm">{error}</p>
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
          onClick={() => onBack()}
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
  );
}
