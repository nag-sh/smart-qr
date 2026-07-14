import React, { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Sparkles, Tag, Type, FileText, Plus, X, Save, SwitchCamera } from 'lucide-react';
import BackButton from '../components/BackButton';
import MessageBanner from '../components/MessageBanner';
import { compressImage } from '../utils/imageCompression';
import { analyzeItemImage } from '../services/gemini';
import { createItem, getBins } from '../services/storage';
import { useCameraDevices } from '../hooks/useCameraDevices';

export default function AddItem({ binId, onNavigate, onBack }) {
  const { hasMultipleCameras } = useCameraDevices();
  // Key state
  const [apiKey, setApiKey] = useState('');
  
  // Bins list state (used if no binId passed in props)
  const [selectedBinId, setSelectedBinId] = useState(binId || '');
  const [binsList, setBinsList] = useState([]);

  useEffect(() => {
    const fetchBins = async () => {
      try {
        const list = await getBins();
        setBinsList(list);
        if (!binId && list.length > 0) {
          setSelectedBinId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load bins for item assignment:', err);
      }
    };
    fetchBins();
  }, [binId]);

  // Form state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [visibleText, setVisibleText] = useState('');
  
  // Tag input state
  const [newTag, setNewTag] = useState('');

  // UI state
  const [compressing, setCompressing] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // WebRTC camera state
  const [useInlineCamera, setUseInlineCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState(null);
  const [shutterFlash, setShutterFlash] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const usingFrontCamera = useRef(false);

  const aiSteps = [
    'Connecting to Gemini Flash...',
    'Uploading compressed image payload...',
    'Analyzing item dimensions and properties...',
    'Extracting logos, colors, and serial numbers...',
    'Formatting JSON metadata response...',
    'Populating inventory form fields...'
  ];

  useEffect(() => {
    const key = localStorage.getItem('gemini_api_key');
    if (key) {
      setApiKey(key);
    }
  }, []);

  // Stop camera tracks on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Hook stream up to video element
  useEffect(() => {
    if (useInlineCamera && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [useInlineCamera, cameraStream]);

  // Step indicator interval during AI analysis
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
  }, [aiAnalyzing]);

  const startInlineCamera = async (facingMode = 'environment') => {
    setError('');
    setCameraReady(false);
    setCapturedFrame(null);
    setShutterFlash(false);

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('WebRTC camera not supported. Opening standard file selector.');
      setCameraStream(null);
      setUseInlineCamera(false);
      triggerFilePicker();
      return;
    }

    const baseConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, ...baseConstraints }
      });
    } catch (err) {
      const fallbackFacingMode = facingMode === 'environment' ? 'user' : 'environment';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: fallbackFacingMode, ...baseConstraints }
        });
      } catch (fallbackErr) {
        console.error('Failed to get camera stream:', fallbackErr);
        setCameraStream(null);
        setUseInlineCamera(false);
        setError('Camera access blocked. Opening file selector...');
        triggerFilePicker();
        return;
      }
    }

    setCameraStream(stream);
    setUseInlineCamera(true);
  };

  const stopInlineCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setUseInlineCamera(false);
    setCameraReady(false);
  };

  const handleSwitchCamera = () => {
    setCameraReady(false);
    usingFrontCamera.current = !usingFrontCamera.current;
    const facingMode = usingFrontCamera.current ? 'user' : 'environment';
    startInlineCamera(facingMode);
  };

  const handleVideoReady = () => {
    const video = videoRef.current;
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      setCameraReady(true);
    }
  };

  useEffect(() => {
    if (!imagePreview && !imageFile) {
      startInlineCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capturePhoto = (e) => {
    if (e) e.stopPropagation();
    const video = videoRef.current;
    if (!video || !cameraReady || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('Camera is not ready yet. Please wait a moment.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setCapturedFrame(dataUrl);
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 300);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setError('Failed to capture frame.');
          return;
        }
        const file = new File([blob], 'item-capture.jpg', { type: 'image/jpeg' });
        
        await processAndAnalyzeImage(file);
        stopInlineCamera();
      }, 'image/jpeg', 0.85);

    } catch (err) {
      console.error('Capture frame error:', err);
      setError('Failed to snap photo. Using file selector fallback...');
      triggerFilePicker();
    }
  };

  const processAndAnalyzeImage = async (file) => {
    setError('');
    setImageFile(null);
    setImagePreview(null);
    setName('');
    setDescription('');
    setTags([]);
    setVisibleText('');
    setCompressing(true);

    try {
      // 1. Compress Image
      const compressed = await compressImage(file, { maxSizeMB: 0.2 });
      setImageFile(compressed);
      
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
      const previewUrl = URL.createObjectURL(compressed);
      setImagePreview(previewUrl);

      // 2. Trigger Gemini AI Analysis if Key is present
      if (apiKey) {
        setAiAnalyzing(true);
        const metadata = await analyzeItemImage(apiKey, compressed);
        
        // Hydrate form
        setName(metadata.title || '');
        setDescription(metadata.description || '');
        
        // Combine tags and colors for search indexing
        const combinedTags = [
          ...(metadata.tags || []),
          ...(metadata.colors || [])
        ].map(t => t.toLowerCase().trim()).filter(Boolean);
        
        setTags(combinedTags);
        setVisibleText(metadata.visible_text || '');
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

  const triggerFilePicker = () => {
    stopInlineCamera();
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleAddTag = (e) => {
    e.preventDefault();
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Item Name is required.');
      return;
    }
    const targetBinId = binId || selectedBinId;
    if (!targetBinId) {
      setError('Please select a storage bin for assignment.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await createItem(targetBinId, name.trim(), description.trim(), tags, visibleText.trim(), imageFile);
      setSuccessMsg('Item saved successfully!');
      setTimeout(() => {
        onNavigate('bin-details', { binId: targetBinId });
      }, 1200);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save item.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 relative overflow-hidden">
      {/* Glow decoration */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="p-5 flex items-center gap-3 border-b border-slate-800/50">
        <BackButton
          onClick={() => onBack()}
          className="-ml-1"
          disabled={loading || aiAnalyzing}
        />
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-200">Catalog Item</h1>
            <p className="text-[10px] text-slate-400">Step-by-step smart tagging</p>
          </div>
        </div>
      </div>

      {/* Missing API Key Warning */}
      {!apiKey && (
        <MessageBanner
          type="warning"
          className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex gap-2.5 text-xs text-amber-300"
          iconClassName="w-4 h-4 shrink-0 mt-0.5 text-amber-400"
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

      {/* AI Loading Screen Overlay */}
      {aiAnalyzing && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-30 space-y-6">
          <div className="relative">
            {/* Outer spinning ring */}
            <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin"></div>
            {/* Glowing sparkles */}
            <Sparkles className="w-6 h-6 text-pink-400 absolute inset-0 m-auto animate-pulse" />
          </div>
          
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-200 text-sm">Gemini AI Auto-Cataloging</h3>
            <div className="h-4 flex items-center justify-center">
              <span className="text-xs text-purple-300 animate-pulse font-medium">
                {aiSteps[aiStep]}
              </span>
            </div>
          </div>

          {/* Step checklist indicators */}
          <div className="w-full max-w-xs space-y-1.5 text-left border-t border-slate-800/60 pt-4">
            {aiSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  idx < aiStep 
                    ? 'bg-purple-500' 
                    : idx === aiStep 
                      ? 'bg-pink-500 animate-ping' 
                      : 'bg-slate-800'
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
        {/* Photo capture input */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Item Photo
          </label>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageChange}
            className="hidden"
          />
          
          <div className={`relative bg-slate-950 overflow-hidden rounded-2xl ${useInlineCamera ? 'aspect-video' : 'aspect-square'}`}>
            {useInlineCamera ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                  onLoadedData={handleVideoReady}
                  onLoadedMetadata={handleVideoReady}
                />
                {capturedFrame && (
                  <img
                    src={capturedFrame}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain z-10"
                  />
                )}
                {shutterFlash && (
                  <div className="absolute inset-0 bg-white z-20 shutter-flash pointer-events-none" />
                )}
                {hasMultipleCameras && (
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    aria-label="Switch camera"
                    className="absolute bottom-4 right-4 z-30 p-2 rounded-full bg-slate-900/80 border border-slate-700/60 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <SwitchCamera className="w-4 h-4" />
                  </button>
                )}
                {!cameraReady && (
                  <div className="absolute bottom-16 left-0 right-0 flex justify-center z-20 pointer-events-none">
                    <span className="px-3 py-1.5 rounded-full bg-slate-900/80 text-slate-300 text-[10px] font-medium">
                      Camera starting...
                    </span>
                  </div>
                )}
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-2 z-20">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    disabled={!cameraReady || compressing || aiAnalyzing}
                    className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Snap
                  </button>
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    className="px-4 py-2.5 bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Upload File
                  </button>
                </div>
              </>
            ) : imagePreview ? (
              <>
                <img src={imagePreview} alt="Item Preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-slate-950/65 opacity-0 hover:opacity-100 flex flex-col items-center justify-center transition-opacity gap-2.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startInlineCamera(); }}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" /> Retake Camera
                  </button>
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-[10px] font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    Upload File
                  </button>
                </div>
              </>
            ) : compressing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-center text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-purple-400" />
                <span>Optimizing photo...</span>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 text-center text-slate-400 p-4">
                <div className="flex flex-col gap-2 px-4 w-full max-w-[240px]">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startInlineCamera(); }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Start Camera
                  </button>
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    className="px-4 py-2 bg-slate-900 border border-slate-800/80 text-slate-300 hover:text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Select File
                  </button>
                </div>
                <span className="block text-[9px] text-slate-500 max-w-[240px] mx-auto leading-normal">WebRTC camera interface for mobile and desktop web browsers</span>
              </div>
            )}
          </div>
        </div>

        {/* Form details */}
        <div className="space-y-4 animate-fade-in">
            {/* Parent Bin Selector (if none passed as prop) */}
            {!binId && (
              <div>
                <label htmlFor="parentBin" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Assign to Storage Bin
                </label>
                <select
                  id="parentBin"
                  value={selectedBinId}
                  onChange={(e) => setSelectedBinId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-105 focus:border-purple-500/50 focus:outline-none cursor-pointer"
                  disabled={loading}
                  required
                >
                  <option value="" disabled>Select a target bin...</option>
                  {binsList.map(b => (
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

            {/* Item Name */}
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
                  disabled={loading}
                />
              </div>
            </div>

            {/* Item Description */}
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
                  disabled={loading}
                />
              </div>
            </div>

            {/* Tags & Colors */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Tags & Colors
              </label>
              
              {/* Active tags list */}
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

              {/* Add Tag input */}
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
                    disabled={loading}
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

            {/* Visible text/labels (OCR) */}
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
                disabled={loading}
              />
            </div>
        </div>

        {error && (
          <MessageBanner
            type="error"
            message={error}
            className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-300"
            iconClassName="w-4 h-4 shrink-0 mt-0.5 animate-pulse"
          />
        )}

        {successMsg && (
          <MessageBanner
            type="success"
            message={successMsg}
            className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center text-xs text-emerald-300"
            iconClassName="hidden"
          />
        )}

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Item
        </button>
      </form>

    </div>
  );
}