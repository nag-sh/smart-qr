import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, Sparkles, Tag, Type, FileText, Plus, X, Save } from 'lucide-react';
import BackButton from '../components/BackButton';
import MessageBanner from '../components/MessageBanner';
import PhotoUploadArea from '../components/PhotoUploadArea';
import InlineCamera from '../components/InlineCamera';
import { compressImage } from '../utils/imageCompression';
import { analyzeItemImage } from '../services/gemini';
import { createItem, updateItem, getBins, searchItems, batchManageItems } from '../services/storage';
import { setPendingCreate } from '../services/pendingCreate';
import useImageSrc from '../hooks/useImageSrc';

export default function ItemForm({
  mode = 'create',
  binId: initialBinId,
  itemId,
  onBack,
  onNavigate,
  refreshNonce
}) {
  const isCreate = mode === 'create';
  const isEdit = mode === 'edit';

  const [apiKey, setApiKey] = useState('');
  const [binsList, setBinsList] = useState([]);
  const [selectedBinId, setSelectedBinId] = useState(initialBinId || '');

  // Form state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [visibleText, setVisibleText] = useState('');

  // Edit mode state
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [showImagePicker, setShowImagePicker] = useState(false);

  // UI state
  const [compressing, setCompressing] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Camera state
  const [useInlineCamera, setUseInlineCamera] = useState(false);

  const fileInputRef = useRef(null);

  const existingImageSrc = useImageSrc(item?.image_url);

  const aiSteps = [
    'Connecting to Gemini Flash...',
    'Uploading compressed image payload...',
    'Analyzing item dimensions and properties...',
    'Extracting logos, colors, and serial numbers...',
    'Formatting JSON metadata response...',
    'Populating inventory form fields...'
  ];

  // Load API key
  useEffect(() => {
    const key = localStorage.getItem('gemini_api_key');
    if (key) setApiKey(key);
  }, []);

  // Load bins once
  useEffect(() => {
    let mounted = true;
    const fetchBins = async () => {
      try {
        const list = await getBins();
        if (!mounted) return;
        setBinsList(list);
        if (isCreate && !initialBinId && list.length > 0) {
          setSelectedBinId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load bins for item assignment:', err);
      }
    };
    fetchBins();
    return () => { mounted = false; };
  }, [isCreate, initialBinId]);

  // Edit mode: fetch item on itemId/refreshNonce change
  useEffect(() => {
    if (!isEdit) return;

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
        setName(found.name || '');
        setDescription(found.description || '');
        setTags((found.search_tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean));
        setVisibleText(found.visible_text || '');
        setSelectedBinId(found.bin_id || '');
        setImageFile(null);
        setImagePreview(null);
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load item');
      } finally {
        setLoading(false);
      }
    };

    fetchItem();
  }, [isEdit, itemId, refreshNonce]);

  // AI step animation
  useEffect(() => {
    let interval;
    if (aiAnalyzing) {
      interval = setInterval(() => {
        setAiStep((prev) => (prev < aiSteps.length - 1 ? prev + 1 : prev));
      }, 2500);
    } else {
      setAiStep(0);
    }
    return () => clearInterval(interval);
  }, [aiAnalyzing, aiSteps.length]);

  // Create mode: auto-start camera if no image yet
  useEffect(() => {
    if (isCreate && !imagePreview && !imageFile) {
      startInlineCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreate]);

  const startInlineCamera = () => {
    setError('');
    setShowImagePicker(false);
    setUseInlineCamera(true);
  };

  const stopInlineCamera = () => {
    setUseInlineCamera(false);
  };

  const triggerFilePicker = () => {
    stopInlineCamera();
    if (isEdit) {
      setShowImagePicker(true);
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const openFilePicker = () => {
    stopInlineCamera();
    setShowImagePicker(false);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleCapture = async (file) => {
    await processAndAnalyzeImage(file);
    stopInlineCamera();
  };

  const processAndAnalyzeImage = async (file) => {
    setError('');
    setCompressing(true);

    try {
      const compressed = await compressImage(file, { maxSizeMB: 0.2 });
      setImageFile(compressed);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(URL.createObjectURL(compressed));

      // First capture in create mode (no image yet): create the item now and
      // hand off to ItemDetails, which runs the AI analysis and auto-populates
      // the fields. This gives an immediate "snap -> details" flow instead of
      // analyzing in place and lingering on the form.
      if (isCreate && !imageFile) {
        const targetBinId = initialBinId || selectedBinId;
        if (targetBinId) {
          // Hand the captured image to ItemDetails via an in-memory holder and
          // navigate now, so the details screen opens immediately. Modal params
          // are URL-serialized and cannot carry a File, so ItemDetails creates
          // the item from the held image in the background, then runs analysis.
          setPendingCreate(compressed);
          onNavigate('item-details', {
            pendingCreate: true,
            binId: targetBinId,
            autoAnalyze: !!apiKey
          });
          return;
        }
        // No bin chosen yet: stay in the form so the user can pick one.
        return;
      }

      if (apiKey) {
        setAiAnalyzing(true);
        const metadata = await analyzeItemImage(apiKey, compressed);
        const combinedTags = [
          ...(metadata.tags || []),
          ...(metadata.colors || [])
        ].map((t) => t.toLowerCase().trim()).filter(Boolean);

        if (isCreate) {
          setName(metadata.title || '');
          setDescription(metadata.description || '');
          setTags(combinedTags);
          setVisibleText(metadata.visible_text || '');
        } else {
          if (metadata.title) setName(metadata.title);
          if (metadata.description) setDescription(metadata.description);
          if (combinedTags.length > 0) setTags(combinedTags);
          if (metadata.visible_text) setVisibleText(metadata.visible_text);
        }
      }
    } catch (err) {
      console.error('Error during image processing/AI analysis:', err);
      setError(err.message || 'AI analysis failed. You can still input details manually.');
    } finally {
      setCompressing(false);
      setAiAnalyzing(false);
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processAndAnalyzeImage(file);
  };

  const handleAddTag = (e) => {
    if (e) e.preventDefault();
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Item Name is required.');
      return;
    }
    const targetBinId = isCreate ? initialBinId || selectedBinId : selectedBinId;
    if (!targetBinId) {
      setError('Please select a storage bin for assignment.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (isCreate) {
        await createItem(targetBinId, name.trim(), description.trim(), tags, visibleText.trim(), imageFile);
        setSuccessMsg('Item saved successfully!');
        setTimeout(() => {
          onNavigate('bin-details', { binId: targetBinId });
        }, 1200);
      } else {
        const fields = {
          name: name.trim(),
          description: description.trim(),
          search_tags: tags,
          visible_text: visibleText.trim(),
          bin_id: targetBinId
        };
        await updateItem(item.id, fields, imageFile);
        // updateItem does not persist bin_id, so move the item if the bin changed.
        if (item.bin_id && targetBinId && targetBinId !== item.bin_id) {
          await batchManageItems(item.bin_id, 'reassign', [item.id], targetBinId);
        }
        onBack();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save item.');
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && loading) {
    return (
      <div className="w-full max-w-2xl mx-auto py-12 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-500" />
        <p className="text-sm text-slate-400">Loading item...</p>
      </div>
    );
  }

  if (isEdit && (error || !item)) {
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

  // Create mode with no photo yet: show a large, minimal camera feed (like
  // Multi-Add) and advance to the editable fields once a picture is taken. The
  // AI-analysis loading overlay (below) then covers the fields while the key is set.
  if (isCreate && !imageFile && !imagePreview) {
    return (
      <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100">
        <div className="p-4 flex items-center gap-3 border-b border-slate-800/50 shrink-0">
          <BackButton onClick={() => onBack()} className="-ml-1" />
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-slate-200">Add Item</h1>
              <p className="text-[10px] text-slate-400">Snap a photo to auto-catalog</p>
            </div>
          </div>
        </div>

        <div className="relative h-[45vh] min-h-[280px] max-h-[480px] bg-slate-900 overflow-hidden shrink-0 m-4 rounded-2xl border border-slate-800/60">
          <InlineCamera
            useInlineCamera={useInlineCamera}
            showCapturedFrame={false}
            onCapture={handleCapture}
            onTriggerFilePicker={() => fileInputRef.current?.click()}
            captureFileName="item-capture.jpg"
            snapButtonLabel="Snap"
            uploadButtonLabel="Upload File"
          />
        </div>

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageChange}
          className="hidden"
        />
      </div>
    );
  }

  const isCameraDisabled = saving || aiAnalyzing || compressing;

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="p-5 flex items-center gap-3 border-b border-slate-800/50">
        <BackButton
          onClick={() => onBack()}
          className="-ml-1"
          disabled={isCameraDisabled}
        />
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-200">{isCreate ? 'Catalog Item' : 'Edit Item'}</h1>
            <p className="text-[10px] text-slate-400">{isCreate ? 'Step-by-step smart tagging' : 'Update item details'}</p>
          </div>
        </div>
      </div>

      {!apiKey && (
        <MessageBanner
          type="warning"
          message={
            <div>
              <strong className="font-semibold">No Gemini API Key set:</strong> AI auto-labeling is disabled. Go to{' '}
              <button
                onClick={() => onNavigate('settings')}
                className="underline hover:text-amber-200 font-bold"
              >
                Settings
              </button>{' '}
              to set up your key, or enter item details manually below.
            </div>
          }
        />
      )}

      {aiAnalyzing && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-30 space-y-6">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin"></div>
            <Sparkles className="w-6 h-6 text-pink-400 absolute inset-0 m-auto animate-pulse" />
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-200 text-sm">Gemini AI Auto-Cataloging</h3>
            <div className="h-4 flex items-center justify-center">
              <span className="text-xs text-purple-300 animate-pulse font-medium">{aiSteps[aiStep]}</span>
            </div>
          </div>
          <div className="w-full max-w-xs space-y-1.5 text-left border-t border-slate-800/60 pt-4">
            {aiSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  idx < aiStep ? 'bg-purple-500' : idx === aiStep ? 'bg-pink-500 animate-ping' : 'bg-slate-800'
                }`}></span>
                <span className={idx === aiStep ? 'text-slate-200 font-medium' : idx < aiStep ? 'text-slate-400' : 'text-slate-600'}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <PhotoUploadArea
          label="Item Photo"
          fileInputRef={fileInputRef}
          onFileChange={handleImageChange}
          imagePreview={imagePreview || existingImageSrc}
          previewAlt="Item Preview"
          compressing={compressing}
          useInlineCamera={useInlineCamera}
          onCapture={handleCapture}
          captureFileName="item-capture.jpg"
          onStartCamera={startInlineCamera}
          onTriggerFilePicker={triggerFilePicker}
          snapButtonLabel="Snap"
          uploadButtonLabel="Upload File"
          startButtonLabel="Start Camera"
          selectButtonLabel={isEdit ? 'Select Photo Source' : 'Select File'}
          retakeButtonLabel="Retake Camera"
          helperText="WebRTC camera interface for mobile and desktop web browsers"
          imageSourceChooser={
            isEdit && showImagePicker && !useInlineCamera ? (
              <div
                className="absolute inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-xs font-semibold text-slate-200">Choose photo source</p>
                <button
                  type="button"
                  onClick={() => startInlineCamera()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" /> Take Photo
                </button>
                <button
                  type="button"
                  onClick={() => openFilePicker()}
                  className="px-4 py-2 bg-slate-900 border border-slate-800/80 text-slate-300 hover:text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setShowImagePicker(false)}
                  className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : null
          }
        />

        <div className="space-y-4 animate-fade-in">
          {isCreate && !initialBinId && (
            <div>
              <label htmlFor="parentBin" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Assign to Storage Bin
              </label>
              <select
                id="parentBin"
                value={selectedBinId}
                onChange={(e) => setSelectedBinId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 focus:border-purple-500/50 focus:outline-none cursor-pointer"
                disabled={saving}
                required
              >
                <option value="" disabled>Select a target bin...</option>
                {binsList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.location})
                  </option>
                ))}
              </select>
              {binsList.length === 0 && (
                <span className="block text-[10px] text-pink-400 mt-1 font-semibold">
                  No bins available. Please create a storage bin first!
                </span>
              )}
            </div>
          )}

          {isEdit && (
            <div>
              <label htmlFor="editBin" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Bin
              </label>
              <select
                id="editBin"
                value={selectedBinId}
                onChange={(e) => setSelectedBinId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100"
                disabled={saving}
              >
                <option value="">No bin</option>
                {binsList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} &bull; {b.location}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="itemName" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex justify-between">
              <span>Item Name</span>
              {apiKey && !aiAnalyzing && <span className="text-[10px] text-purple-400 flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" /> AI Autocompleted</span>}
            </label>
            <div className="relative">
              <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input
                id="itemName"
                type="text"
                placeholder="e.g. Vintage Leather Jacket"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl glass-input text-sm text-slate-100 focus:border-purple-500/50"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label htmlFor="itemDesc" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Description
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-3 text-slate-500 w-4 h-4" />
              <textarea
                id="itemDesc"
                rows="2"
                placeholder="Describe condition, size, features..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl glass-input text-sm text-slate-100 focus:border-purple-500/50 resize-none"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Tags & Colors
            </label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/25 text-xs text-purple-300 flex items-center gap-1.5"
                >
                  <Tag className="w-3.5 h-3.5 text-purple-400" />
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-400 focus:outline-none shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Add tag (e.g. vintage)"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag(e);
                    }
                  }}
                  className="w-full pl-10 pr-4 py-2 rounded-xl glass-input text-xs text-slate-100"
                  disabled={saving}
                />
              </div>
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="visibleText" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex justify-between">
              <span>OCR extracted text</span>
              <span className="text-[9px] text-slate-500 lowercase">Labels, brands, serials</span>
            </label>
            <textarea
              id="visibleText"
              rows="2"
              placeholder="Any text printed on the item..."
              value={visibleText}
              onChange={(e) => setVisibleText(e.target.value)}
              className="w-full px-4 py-3 rounded-xl glass-input text-xs text-slate-100 placeholder-slate-600 font-mono resize-none"
              disabled={saving}
            />
          </div>
        </div>

        {error && <MessageBanner type="error" message={error} />}

        {successMsg && (
          <MessageBanner
            type="success"
            message={successMsg}
            iconClassName="hidden"
          />
        )}

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isCreate ? 'Save Item' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
