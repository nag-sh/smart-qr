import React, { useCallback, useEffect, useRef, useState } from 'react';

// allow: SIZE_OK — The multi-add bulk-entry feature is confined to this single new file by the
// issue/branch constraint (GitHub #9). Splitting would require creating additional files outside the
// allowed scope. Refactor into sub-components if that constraint is lifted.
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import InlineCamera from '../components/InlineCamera';
import MessageBanner from '../components/MessageBanner';
import { compressImage } from '../utils/imageCompression';
import { analyzeItemImage } from '../services/gemini';
import { createItem, deleteItem, batchDeleteItems, getBins } from '../services/storage';
import { retryWithBackoff, isRetryableError } from '../utils/retryWithBackoff';

/**
 * Roll thumbnail. Blob URLs are cheap and the roll is uncapped, so the image is
 * rendered directly rather than gated behind an IntersectionObserver — the observer
 * left cards stuck on the placeholder inside the horizontal scroller.
 */
function LazyThumbnail({ src, alt, className }) {
  return (
    <div className={className}>
      <img src={src} alt={alt} className="w-full h-full object-cover" />
    </div>
  );
}

export default function MultiAddModal({ binId, onNavigate, onBack, refreshNonce, onRefresh }) {
  const [roll, setRoll] = useState([]);
  const [apiKey, setApiKey] = useState('');
  const rollRef = useRef(roll);
  const rollScrollRef = useRef(null);
  const inFlightRef = useRef(0);
  const queueRef = useRef([]);
  const fileInputRef = useRef(null);
  const [selectedBinId, setSelectedBinId] = useState(binId || '');
  const [binsList, setBinsList] = useState([]);
  const [binsLoading, setBinsLoading] = useState(false);
  const effectiveBinId = binId || selectedBinId;

  useEffect(() => {
    rollRef.current = roll;
  }, [roll]);

  // Keep the newest capture in view: pin the horizontal roll to the right edge as it grows.
  useEffect(() => {
    const el = rollScrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [roll.length]);

  const refreshApiKey = useCallback(() => {
    setApiKey(localStorage.getItem('gemini_api_key') || '');
  }, []);

  useEffect(() => {
    refreshApiKey();
  }, [refreshApiKey, refreshNonce]);

  useEffect(() => {
    if (binId) return;
    let mounted = true;
    setBinsLoading(true);
    getBins()
      .then((list) => { if (mounted) setBinsList(list || []); })
      .catch(() => {})
      .finally(() => { if (mounted) setBinsLoading(false); });
    return () => {
      mounted = false;
    };
  }, [binId]);

  const setCard = useCallback((id, updater) => {
    setRoll((prev) =>
      prev.map((card) =>
        card.id === id ? (typeof updater === 'function' ? updater(card) : updater) : card,
      ),
    );
  }, []);

  const removeCard = useCallback((id) => {
    const card = rollRef.current.find((c) => c.id === id);
    if (card) {
      try {
        card.abortController.abort();
      } catch {
        // Abort may throw if already settled; ignore.
      }
      URL.revokeObjectURL(card.previewUrl);
    }
    setRoll((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const processCard = useCallback(
    async (id, file, abortController) => {
      try {
        setCard(id, (card) => ({ ...card, attempts: card.attempts + 1 }));

        const compressed = await compressImage(file, { maxSizeMB: 0.2 });

        const metadata = await retryWithBackoff(
          () => analyzeItemImage(apiKey, compressed, abortController.signal),
          {
            maxAttempts: 2,
            delayMs: 1000,
            shouldRetry: isRetryableError,
            signal: abortController.signal,
          },
        );

        const tags = [
          ...(metadata.tags || []),
          ...(metadata.colors || [])
        ]
          .map((s) => String(s).trim().toLowerCase())
          .filter(Boolean);

        const item = await createItem(
          effectiveBinId,
          metadata.title || 'Untitled item',
          metadata.description || '',
          tags,
          metadata.visible_text || '',
          compressed,
        );

        setCard(id, (card) => ({ ...card, status: 'success', item }));
      } catch (err) {
        if (abortController.signal.aborted) {
          removeCard(id);
          return;
        }
        setCard(id, (card) => ({ ...card, status: 'failed', error: err.message || 'Failed to process item' }));
      }
    },
    [apiKey, effectiveBinId, setCard, removeCard],
  );

  const runQueue = useCallback(() => {
    while (inFlightRef.current < 3 && queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      inFlightRef.current += 1;
      job().finally(() => {
        inFlightRef.current -= 1;
        runQueue();
      });
    }
  }, []);

  const handleCapturePreview = useCallback(
    (preview, captureId) => {
      if (!apiKey || !captureId) return;

      // Drop the thumbnail in the instant the shutter fires. The encoded file
      // lands a beat later via handleCapture, which upgrades this same card.
      const abortController = new AbortController();
      const card = {
        id: captureId,
        file: null,
        previewUrl: preview,
        status: 'processing',
        item: null,
        error: null,
        attempts: 0,
        abortController,
      };

      setRoll((prev) => [...prev, card]);
      // Keep the ref in sync immediately. handleCapture looks the card up via
      // rollRef in the SAME tick (capturePhoto fires onCapture right after
      // onCapturePreview), but rollRef is otherwise only synced in a useEffect
      // that runs after render — so without this the lookup misses and the card
      // hangs on "Analyzing" forever.
      rollRef.current = [...rollRef.current, card];
    },
    [apiKey],
  );

  const handleCapture = useCallback(
    (file, captureId) => {
      if (!apiKey) return;

      // Camera path: a preview card was created synchronously above. Upgrade it
      // with the encoded file and start processing.
      if (captureId) {
        const existing = rollRef.current.find((c) => c.id === captureId);
        if (!existing) return; // preview card was removed before the file landed
        const abortController = existing.abortController;
        setCard(captureId, (c) => ({ ...c, file, previewUrl: URL.createObjectURL(file) }));
        queueRef.current.push(() => processCard(captureId, file, abortController));
        runQueue();
        return;
      }

      // File-picker path: no preview exists, create the card now.
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const abortController = new AbortController();

      const card = {
        id,
        file,
        previewUrl,
        status: 'processing',
        item: null,
        error: null,
        attempts: 0,
        abortController,
      };

      setRoll((prev) => [...prev, card]);
      queueRef.current.push(() => processCard(id, file, abortController));
      runQueue();
    },
    [apiKey, processCard, runQueue, setCard],
  );

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleCapture(file);
      e.target.value = '';
    },
    [handleCapture],
  );

  const handleRemoveCard = useCallback(
    async (id) => {
      const card = rollRef.current.find((c) => c.id === id);
      if (!card) return;

      if (card.status === 'success' && card.item) {
        try {
          await deleteItem(card.item.id);
        } catch (err) {
          console.error('Failed to delete item:', err);
        }
      }

      removeCard(id);
    },
    [removeCard],
  );

  const handleClearAll = useCallback(async () => {
    const successCards = rollRef.current.filter((c) => c.status === 'success');
    const successIds = successCards.map((c) => c.item.id).filter(Boolean);

    if (successIds.length > 0) {
      try {
        await batchDeleteItems(successIds);
      } catch (err) {
        console.error('Failed to clear all items:', err);
      }
    }

    rollRef.current.forEach((card) => {
      try {
        card.abortController.abort();
      } catch {
        // Ignore.
      }
      URL.revokeObjectURL(card.previewUrl);
    });

    setRoll([]);
  }, []);

  useEffect(() => {
    return () => {
      // Do NOT abort in-flight jobs on unmount: processing must continue in the
      // background so items still get added to the bin after the modal is closed.
      // Only release the preview blob URLs to avoid leaking them.
      rollRef.current.forEach((card) => {
        if (card.previewUrl) URL.revokeObjectURL(card.previewUrl);
      });
    };
  }, []);

  const hasRoll = roll.length > 0;

  const handleBack = () => {
    onRefresh?.();
    onBack();
  };

  if (!effectiveBinId) {
    return (
      <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
        <div className="p-4 flex items-center border-b border-slate-800/50 shrink-0">
        <button
          type="button"
          onClick={handleBack}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <h1 className="ml-3 font-bold text-sm text-slate-200">Multi-Add</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <Camera className="w-10 h-10 text-slate-600 mb-4" />
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Choose a bin</h2>
          <p className="text-[11px] text-slate-400 mb-4 text-center max-w-xs">
            Multi-add needs a destination bin. Pick one to start capturing.
          </p>
          {binsLoading ? (
            <p className="text-[11px] text-slate-500">Loading bins...</p>
          ) : binsList.length === 0 ? (
            <p className="text-[11px] text-slate-500">No bins yet. Create one first.</p>
          ) : (
            <select
              value={selectedBinId}
              onChange={(e) => setSelectedBinId(e.target.value)}
              className="w-full max-w-xs px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm cursor-pointer"
            >
              <option value="" disabled>Select a bin...</option>
              {binsList.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.location ? ` (${b.location})` : ''}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
      <div className="p-4 flex items-center justify-between border-b border-slate-800/50 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-200">Multi-Add</h1>
            <p className="text-[10px] text-slate-400">Snap photos to auto-catalog</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClearAll}
          disabled={!hasRoll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer text-xs font-bold"
        >
          <Trash2 className="w-4 h-4" /> Clear all
        </button>
      </div>

      {!apiKey && (
        <div className="px-4 pt-4 shrink-0">
          <MessageBanner
            type="warning"
            message={
              <div>
                <strong className="font-semibold">No Gemini API Key set:</strong> AI auto-labeling
                is disabled. Go to{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="underline hover:text-amber-200 font-bold"
                >
                  Settings
                </button>{' '}
                to set up your key.
              </div>
            }
          />
        </div>
      )}

      <div className="relative h-[45vh] min-h-[280px] max-h-[480px] bg-slate-900 overflow-hidden shrink-0 m-4 rounded-2xl border border-slate-800/60">
        <InlineCamera
          useInlineCamera
          showCapturedFrame={false}
          onCapture={handleCapture}
          onCapturePreview={handleCapturePreview}
          onTriggerFilePicker={() => fileInputRef.current?.click()}
          captureFileName="multi-add-capture.jpg"
          snapButtonLabel="Snap"
          uploadButtonLabel="Upload File"
        />

        {!apiKey && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
            <Camera className="w-10 h-10 text-slate-500 mb-3" />
            <p className="text-sm text-slate-300 mb-4 max-w-xs">
              A Gemini API key is required to analyze photos. Add one in Settings to start capturing.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg active:scale-95 transition-transform cursor-pointer"
            >
              Open Settings
            </button>
          </div>
        )}
      </div>

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Roll ({roll.length})
          </h2>
          <span className="text-[10px] text-slate-500">Scroll to review</span>
        </div>

        <div ref={rollScrollRef} className="flex-1 overflow-x-auto -mx-4 px-4">
          <div className="flex items-stretch gap-3 min-h-full">
            {roll.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8 min-w-[16rem]">
                <Camera className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">No captures yet.</p>
                <p className="text-[10px] text-slate-600">Tap the shutter to catalog your first item.</p>
              </div>
            )}

            {roll.map((card) => {
              const clickable = card.status === 'success' && card.item?.id;
              return (
                <div
                  key={card.id}
                  onClick={clickable ? () => onNavigate('item-details', { itemId: card.item.id }) : undefined}
                  className={`flex-shrink-0 w-36 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden flex flex-col ${clickable ? 'cursor-pointer' : ''}`}
                >
                <div className="relative h-36 bg-slate-950">
                  <LazyThumbnail
                    src={card.previewUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full"
                  />

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveCard(card.id); }}
                    className="absolute top-1.5 right-1.5 z-20 p-1 rounded-full bg-slate-950/70 text-slate-300 hover:text-white hover:bg-slate-900/90 transition-colors cursor-pointer"
                    aria-label="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                  {card.status === 'success' && (
                    <div className="absolute top-1.5 left-1.5 z-20 p-1 rounded-full bg-emerald-500/20 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  )}

                  {card.status === 'processing' && (
                    <div className="absolute inset-0 z-10 bg-slate-950/50 flex flex-col items-center justify-center gap-1.5">
                      <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                      <span className="text-[9px] font-medium text-slate-300">Analyzing</span>
                    </div>
                  )}

                  {card.status === 'failed' && (
                    <div className="absolute inset-0 z-10 bg-slate-950/60 flex flex-col items-center justify-center gap-1">
                      <AlertCircle className="w-6 h-6 text-red-500" />
                      <span className="text-[9px] font-medium text-red-300">Failed</span>
                    </div>
                  )}
                </div>

                <div className="p-2 flex-1 flex flex-col justify-center min-h-[3.5rem]">
                  {card.status === 'success' && card.item ? (
                    <p className="text-[10px] font-medium text-slate-200 line-clamp-2">
                      {card.item.name}
                    </p>
                  ) : card.status === 'processing' ? (
                    <p className="text-[10px] text-slate-400">Processing...</p>
                  ) : (
                    <p className="text-[10px] text-red-400 line-clamp-3" title={card.error}>
                      {card.error || 'Failed'}
                    </p>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
