import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Package, MapPin, Tag, RefreshCw, Eye, Edit, Trash2, MoreHorizontal, Sparkles
} from 'lucide-react';
import { searchItems, getBin, deleteItem, updateItem, createItem } from '../services/storage';
import { takePendingCreate } from '../services/pendingCreate';
import useImageSrc from '../hooks/useImageSrc';
import { analyzeItemImage } from '../services/gemini';
import { getImageBlob, isImageRef } from '../services/localImages';
import { compressImage } from '../utils/imageCompression';
import BackButton from '../components/BackButton';
import MessageBanner from '../components/MessageBanner';

export default function ItemDetails({
  onNavigate,
  itemId,
  onBack,
  refreshNonce,
  autoAnalyze: autoAnalyzeParam = false,
  pendingCreate: pendingCreateParam = false,
  binId
}) {
  // Modal params are URL-serialized on every render, which turns booleans into
  // strings ("false" is truthy) and null into the literal string "null", so
  // coerce explicitly here.
  const autoAnalyze = autoAnalyzeParam === true || autoAnalyzeParam === 'true';
  const pendingCreate = pendingCreateParam === true || pendingCreateParam === 'true';
  const effectiveBinId = binId && binId !== 'null' ? binId : null;
  const [item, setItem] = useState(null);
  const [resolvedItemId, setResolvedItemId] = useState(itemId);
  const [bin, setBin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createStatus, setCreateStatus] = useState('');

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
  const [showFullImage, setShowFullImage] = useState(false);

  const [autoAnalyzing, setAutoAnalyzing] = useState(false);
  const [autoError, setAutoError] = useState('');
  const autoAnalyzeStarted = useRef(false);

  // A File cannot travel through URL-serialized modal params, so ItemForm stashes
  // the captured image in a module-level holder; we compress + create the item here
  // (background) and own the loading state for the whole handoff so it can't stick.
  useEffect(() => {
    if (!pendingCreate || resolvedItemId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setCreateStatus('Reading captured photo…');
      const file = takePendingCreate();
      if (!file) {
        if (!cancelled) {
          setError('Captured image was lost. Please try adding the item again.');
          setLoading(false);
        }
        return;
      }
      try {
        setCreateStatus('Compressing photo…');
        const compressed = await compressImage(file, { maxSizeMB: 0.2 });
        setCreateStatus('Saving item to this device…');
        const created = await createItem(effectiveBinId, '', '', [], '', compressed);
        if (cancelled) return;
        setCreateStatus('Loading item details…');
        const items = await searchItems('');
        const found = items.find((i) => i.id === created.id);
        setItem(found || null);
        setLoading(false);
        // Set this last: it changes a dependency, which re-runs the effect and
        // fires the cleanup that flips `cancelled`. Doing it after the final
        // state update avoids the effect bailing out and leaving loading stuck.
        setResolvedItemId(created.id);
      } catch (err) {
        console.error('[snap-create] failed:', err);
        if (!cancelled) {
          setError((err && err.message) || 'Failed to create item.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pendingCreate, effectiveBinId, resolvedItemId]);

  useEffect(() => {
    if (pendingCreate) return; // creation effect owns loading + item for the handoff
    if (!resolvedItemId) {
      setLoading(false);
      setError('Item ID is missing');
      return;
    }

    const fetchItem = async () => {
      setLoading(true);
      setError('');
      try {
        const items = await searchItems('');
        const found = items.find((i) => i.id === resolvedItemId);
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
  }, [pendingCreate, resolvedItemId, refreshNonce]);

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

  // Runs the same AI analysis as the manual review flow but auto-applies the
  // proposed fields to the item, used by the Add Item "snap -> details" handoff.
  const runAutoAnalyze = useCallback(async () => {
    if (!item) return;
    setAutoError('');
    setAutoAnalyzing(true);
    try {
      const apiKey = localStorage.getItem('gemini_api_key');
      const file = await imageUrlToFile(item.image_url);
      const metadata = await analyzeItemImage(apiKey, file);
      const proposedTags = [
        ...(metadata.tags || []),
        ...(metadata.colors || [])
      ].map((t) => t.toLowerCase().trim()).filter(Boolean);
      const fields = {};
      if ((metadata.title || '').trim()) fields.name = metadata.title.trim();
      if ((metadata.description || '').trim()) fields.description = metadata.description.trim();
      if (proposedTags.length) fields.search_tags = proposedTags;
      if ((metadata.visible_text || '').trim()) fields.visible_text = metadata.visible_text.trim();
      const updated = await updateItem(item.id, fields);
      setItem(updated);
    } catch (err) {
      console.error(err);
      setAutoError(err.message || 'AI analysis failed.');
    } finally {
      setAutoAnalyzing(false);
    }
  }, [item]);

  // Auto-run analysis on a freshly created item so Add Item lands on populated
  // details (progress bar, not the review modal).
  useEffect(() => {
    if (!autoAnalyze || autoAnalyzeStarted.current) return;
    if (!item) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;
    const hasData =
      (item.name && item.name.trim()) ||
      (item.description && item.description.trim()) ||
      (item.search_tags && item.search_tags.length);
    if (hasData) return;
    autoAnalyzeStarted.current = true;
    runAutoAnalyze();
  }, [item, autoAnalyze, runAutoAnalyze]);

  const aiAnalysisDisabled = !localStorage.getItem('gemini_api_key') || !item?.image_url;

  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">
          {createStatus || 'Loading item details...'}
        </p>
      </div>
    );
  }

  if (error || !item) {
    return (
    <div className="w-full max-w-4xl min-w-[min(80vw,56rem)] mx-auto py-6 px-4 space-y-6">
        <BackButton onClick={() => onBack()} />

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
        <BackButton onClick={() => onBack()} />

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
                  onNavigate('edit-item', { itemId: item.id });
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

      {/* Minimized AI progress for the Add Item snap -> details handoff */}
      {autoAnalyzing && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur border-b border-purple-500/30">
          <div className="h-1 w-full bg-slate-800 overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse" />
          </div>
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-slate-300">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
            <span>Analyzing image…</span>
          </div>
        </div>
      )}

      {!autoAnalyzing && autoError && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center gap-3">
          <span className="flex-1 text-xs text-red-300">{autoError}</span>
          <button
            type="button"
            onClick={runAutoAnalyze}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}


      {/* Item hero card */}
      <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl relative flex flex-col md:flex-row">
        {/* Left side/top: Photo */}
        <div className="w-full md:w-1/3 aspect-video md:aspect-auto md:min-h-[160px] bg-slate-900 flex items-center justify-center relative border-b md:border-b-0 md:border-r border-slate-800/60">
          {itemImageSrc ? (
            <button onClick={() => setShowFullImage(true)} className="w-full h-full block cursor-pointer">
              <img src={itemImageSrc} alt={item.name || 'Untitled Item'} className="w-full h-full object-cover" />
            </button>
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
              <MessageBanner
                type="error"
                message={aiError}
                className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-300"
                iconClassName="w-4 h-4 shrink-0 mt-0.5"
              />
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

      {/* Full-screen image viewer */}
      {showFullImage && itemImageSrc && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950 flex flex-col"
          onClick={() => setShowFullImage(false)}
        >
          <div className="pt-[max(env(safe-area-inset-top),2rem)] px-4">
            <BackButton
              onClick={() => setShowFullImage(false)}
              aria-label="Back"
            />
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <img
              src={itemImageSrc}
              alt={item.name || 'Untitled Item'}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}
