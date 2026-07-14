import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Package, MapPin, Tag, RefreshCw, Eye, Edit, Trash2, MoreHorizontal, Sparkles, AlertCircle
} from 'lucide-react';
import { searchItems, getBin, deleteItem, updateItem } from '../services/storage';
import useImageSrc from '../hooks/useImageSrc';
import { analyzeItemImage } from '../services/gemini';
import { getImageBlob, isImageRef } from '../services/localImages';

export default function ItemDetails({ onNavigate, itemId, onBack, refreshNonce }) {
  const [item, setItem] = useState(null);
  const [bin, setBin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowMenuRef = useRef(null);
  const itemImageSrc = useImageSrc(item?.image_url);

  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiProposed, setAiProposed] = useState(null);
  const [aiChecked, setAiChecked] = useState({
    name: false,
    description: false,
    search_tags: false,
    visible_text: false
  });
  const [aiApplying, setAiApplying] = useState(false);

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
  }, [itemId, refreshNonce]);

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

  const imageUrlToFile = async (imageUrl) => {
    if (isImageRef(imageUrl)) {
      const blob = await getImageBlob(imageUrl);
      if (!blob) throw new Error('Could not load local image.');
      return new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
    }
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Could not load image.');
    const blob = await response.blob();
    return new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
  };

  const handleAiAnalysis = async () => {
    setShowOverflowMenu(false);
    setAiReviewOpen(true);
    setAiLoading(true);
    setAiError('');
    setAiProposed(null);
    setAiChecked({
      name: false,
      description: false,
      search_tags: false,
      visible_text: false
    });
    try {
      const apiKey = localStorage.getItem('gemini_api_key');
      const file = await imageUrlToFile(item.image_url);
      const metadata = await analyzeItemImage(apiKey, file);
      const proposedTags = [
        ...(metadata.tags || []),
        ...(metadata.colors || [])
      ].map((t) => t.toLowerCase().trim()).filter(Boolean);
      const proposed = {
        name: metadata.title || '',
        description: metadata.description || '',
        search_tags: proposedTags,
        visible_text: metadata.visible_text || ''
      };
      setAiProposed(proposed);
      setAiChecked({
        name: proposed.name !== (item.name || ''),
        description: proposed.description !== (item.description || ''),
        search_tags: JSON.stringify(proposed.search_tags) !== JSON.stringify(item.search_tags || []),
        visible_text: proposed.visible_text !== (item.visible_text || '')
      });
    } catch (err) {
      console.error(err);
      setAiError(err.message || 'AI analysis failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiApply = async () => {
    const fields = {};
    if (aiChecked.name) fields.name = aiProposed.name;
    if (aiChecked.description) fields.description = aiProposed.description;
    if (aiChecked.search_tags) fields.search_tags = aiProposed.search_tags;
    if (aiChecked.visible_text) fields.visible_text = aiProposed.visible_text;
    if (Object.keys(fields).length === 0) return;
    setAiApplying(true);
    setAiError('');
    try {
      const updated = await updateItem(item.id, fields);
      setItem(updated);
      setAiReviewOpen(false);
    } catch (err) {
      console.error(err);
      setAiError(err.message || 'Failed to apply changes.');
    } finally {
      setAiApplying(false);
    }
  };

  const aiAnalysisDisabled = !localStorage.getItem('gemini_api_key') || !item?.image_url;

  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">Loading item details...</p>
      </div>
    );
  }

  if (error || !item) {
    return (
    <div className="w-full max-w-4xl min-w-[min(80vw,56rem)] mx-auto py-6 px-4 space-y-6">
        <button
          onClick={() => onBack()}
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
          onClick={() => onBack()}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="relative" ref={overflowMenuRef}>
          <button
            onClick={() => setShowOverflowMenu(prev => !prev)}
            aria-label="More actions"
            aria-expanded={showOverflowMenu}
            className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700/50"
            title="More actions"
          >
            <MoreHorizontal className="w-6 h-6" />
          </button>
          {showOverflowMenu && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-50 py-1">
              <button
                onClick={() => {
                  setShowOverflowMenu(false);
                  onNavigate('edit-item', { itemId });
                }}
                className="w-full px-4 py-3 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Edit className="w-4 h-4 text-purple-400" /> Edit Item
              </button>
              <button
                onClick={() => {
                  setShowOverflowMenu(false);
                  handleAiAnalysis();
                }}
                disabled={aiAnalysisDisabled}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2 transition-colors cursor-pointer ${
                  aiAnalysisDisabled
                    ? 'text-slate-500 cursor-not-allowed'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Sparkles className={`w-4 h-4 ${aiAnalysisDisabled ? 'text-slate-500' : 'text-purple-400'}`} /> AI Analysis
              </button>
              <button
                onClick={() => {
                  setShowOverflowMenu(false);
                  handleDelete();
                }}
                disabled={deleting}
                className="w-full px-4 py-3 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-red-400 flex items-center gap-2 transition-colors cursor-pointer"
              >
                {deleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />} Delete Item
              </button>
            </div>
          )}
        </div>
      </div>


      {/* Item hero card */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row">
        {/* Left side/top: Photo */}
        <div className="w-full md:w-1/3 aspect-video md:aspect-auto md:min-h-[160px] bg-slate-900 flex items-center justify-center relative border-b md:border-b-0 md:border-r border-slate-800/60">
          {itemImageSrc ? (
            <img src={itemImageSrc} alt={item.name || 'Untitled Item'} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-12 h-12 text-slate-700 stroke-1" />
          )}
        </div>

        {/* Right side/details */}
        <div className="p-6 flex-1 flex flex-col justify-between relative">
          <div className="space-y-3">
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
              {item.name || 'Untitled Item'}
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

      {/* AI Analysis Review Modal */}
      {aiReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 shadow-2xl space-y-5 relative max-h-[90vh] flex flex-col">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <h2 className="text-base font-bold text-slate-200">AI Analysis Review</h2>
            </div>

            {itemImageSrc && (
              <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 h-40">
                <img src={itemImageSrc} alt="Analyzed item" className="w-full h-full object-contain" />
              </div>
            )}

            {aiLoading && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
                <p className="text-xs text-slate-400">Analyzing image with Gemini...</p>
              </div>
            )}

            {!aiLoading && aiError && (
              <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{aiError}</span>
              </div>
            )}

            {!aiLoading && aiProposed && (
              <div className="flex-1 overflow-y-auto space-y-3">
                <div className="grid grid-cols-5 gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2">
                  <span className="col-span-1">Field</span>
                  <span className="col-span-2">Current</span>
                  <span className="col-span-2">Proposed</span>
                </div>

                {[
                  { key: 'name', label: 'Name', current: item.name || '', proposed: aiProposed.name },
                  { key: 'description', label: 'Description', current: item.description || '', proposed: aiProposed.description },
                  { key: 'search_tags', label: 'Tags', current: item.search_tags || [], proposed: aiProposed.search_tags },
                  { key: 'visible_text', label: 'Visible Text', current: item.visible_text || '', proposed: aiProposed.visible_text }
                ].map((field) => (
                  <label
                    key={field.key}
                    className="grid grid-cols-5 gap-2 items-start p-3 rounded-2xl border border-slate-800/80 bg-slate-950/40 hover:bg-slate-900/60 cursor-pointer select-none"
                  >
                    <div className="col-span-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={aiChecked[field.key]}
                        onChange={() => setAiChecked((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-slate-300">{field.label}</span>
                    </div>
                    <div className="col-span-2 text-xs text-slate-400 break-words">
                      {Array.isArray(field.current) ? (
                        field.current.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {field.current.map((tag) => (
                              <span key={tag} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px]">{tag}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="italic text-slate-600">—</span>
                        )
                      ) : field.current ? (
                        field.current
                      ) : (
                        <span className="italic text-slate-600">—</span>
                      )}
                    </div>
                    <div className="col-span-2 text-xs text-purple-300 break-words">
                      {Array.isArray(field.proposed) ? (
                        field.proposed.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {field.proposed.map((tag) => (
                              <span key={tag} className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-[10px]">{tag}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="italic text-slate-600">—</span>
                        )
                      ) : field.proposed ? (
                        field.proposed
                      ) : (
                        <span className="italic text-slate-600">—</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAiReviewOpen(false)}
                disabled={aiApplying}
                className="flex-1 py-3 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAiApply}
                disabled={aiApplying || !Object.values(aiChecked).some(Boolean)}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                {aiApplying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Apply selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
