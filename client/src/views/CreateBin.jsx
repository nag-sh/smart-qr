import React, { useState, useRef, useEffect } from 'react';
import { Box, MapPin, Camera, AlertCircle, RefreshCw, Save, ArrowLeft, QrCode, Sparkles, CheckCircle2, ArrowRight, Printer, SwitchCamera } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { createBin, getBins } from '../services/storage';
import { useCameraDevices } from '../hooks/useCameraDevices';

export default function CreateBin({ qrId, onNavigate, onPrintBin, onBack, refreshNonce }) {
  const { devices, currentDeviceId, switchCamera, hasMultipleCameras } = useCameraDevices();
  // Mode switcher when qrId is undefined: 'choice' | 'form'
  const [flowMode, setFlowMode] = useState(qrId ? 'form' : 'choice');
  const [generateMode, setGenerateMode] = useState(false); // True if system generating QR

  // Form inputs
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [allLocations, setAllLocations] = useState([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const binsList = await getBins();
        const locs = Array.from(new Set(binsList.map(b => b.location).filter(Boolean)));
        setAllLocations(locs);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLocations();
  }, [refreshNonce]);
  
  // UI States
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Inline WebRTC camera states
  const [useInlineCamera, setUseInlineCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState(null);
  const [shutterFlash, setShutterFlash] = useState(false);

  // Success state for generated digital QR
  const [successBin, setSuccessBin] = useState(null);
  const [generatedQrText, setGeneratedQrText] = useState('');
  
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);

  // Stop camera tracks on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Hook stream up to video element when active
  useEffect(() => {
    if (useInlineCamera && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [useInlineCamera, cameraStream]);

  const startInlineCamera = async (deviceId = currentDeviceId) => {
    setError('');
    setCameraReady(false);
    setCapturedFrame(null);
    setShutterFlash(false);

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Browser does not support WebRTC cameras. Opening standard file selector.');
      setCameraStream(null);
      setUseInlineCamera(false);
      triggerFilePicker();
      return;
    }

    const baseConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, ...baseConstraints }
          : { facingMode: 'environment', ...baseConstraints }
      });
    } catch (err) {
      if (deviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', ...baseConstraints }
          });
        } catch (fallbackErr) {
          console.error('Failed to get camera stream:', fallbackErr);
          setCameraStream(null);
          setUseInlineCamera(false);
          setError('Camera access blocked. Opening file selector...');
          triggerFilePicker();
          return;
        }
      } else {
        console.error('Failed to get camera stream:', err);
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
    const nextDeviceId = switchCamera();
    startInlineCamera(nextDeviceId);
  };

  const handleVideoReady = () => {
    const video = videoRef.current;
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      setCameraReady(true);
    }
  };

  useEffect(() => {
    if (flowMode === 'form' && !imagePreview && !imageFile) {
      startInlineCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowMode]);

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
        const file = new File([blob], 'bin-capture.jpg', { type: 'image/jpeg' });
        await processAndSetImage(file);
        stopInlineCamera();
      }, 'image/jpeg', 0.85);

    } catch (err) {
      console.error('Capture error:', err);
      setError('Failed to capture photo. Using file selector fallback...');
      triggerFilePicker();
    }
  };

  const processAndSetImage = async (file) => {
    setCompressing(true);
    setError('');
    try {
      const options = {
        maxSizeMB: 0.25,
        maxWidthOrHeight: 1024,
        useWebWorker: true
      };
      
      const compressed = await imageCompression(file, options);
      setImageFile(compressed);
      
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
      const previewUrl = URL.createObjectURL(compressed);
      setImagePreview(previewUrl);
    } catch (err) {
      console.error('Image compression failed:', err);
      setError('Failed to process image.');
    } finally {
      setCompressing(false);
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processAndSetImage(file);
  };

  const triggerFilePicker = () => {
    stopInlineCamera();
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setError('');

    try {
      let finalQrId = qrId;
      let generatedText = '';

      if (generateMode) {
        // Generate a cryptographically secure random UUID for the bin ID
        const binUuid = crypto.randomUUID();
        // Seed unique text including app, owner, ID, and Name slug to ensure uniqueness
        generatedText = `APP: Smart QR Inventory | OWNER: dion | ID: ${binUuid} | NAME: ${name.trim()}`;
        finalQrId = generatedText;
      }

      const bin = await createBin(finalQrId, name.trim(), location.trim(), imageFile);

      if (generateMode) {
        // If we generated the digital QR code, show the receipt view first
        setGeneratedQrText(generatedText);
        setSuccessBin(bin);
      } else {
        // If scanned, go straight to the bin details
        onNavigate('bin-details', { binId: bin.id });
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create bin.');
    } finally {
      setLoading(false);
    }
  };

  // 1. CHOOSE LINK MODE SCREEN
  if (flowMode === 'choice') {
    return (
      <div className="w-full max-w-4xl mx-auto py-6 px-4 space-y-6 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl"></div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onBack()}
            className="p-2 -ml-1 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-500/10 rounded-full text-purple-400">
              <QrCode className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-200">Register Storage Bin</h1>
              <p className="text-xs text-slate-400 max-w-xs">
                How would you like to assign a QR code to this physical container?
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          {/* Option A: Scan existing */}
          <button
            onClick={() => onNavigate('scanner')}
            className="w-full p-4 rounded-2xl glass-card text-left flex items-start gap-4 hover:border-purple-500/30 transition-all cursor-pointer group"
          >
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl shrink-0 group-hover:scale-105 transition-transform">
              <Camera className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-200 group-hover:text-purple-300 transition-colors">
                Scan pre-printed QR code
              </h3>
              <p className="text-xs text-slate-400 leading-normal">
                Use your device camera to scan an existing label or custom print roll already attached to your bin.
              </p>
            </div>
          </button>

          {/* Option B: System generated */}
          <button
            onClick={() => {
              setGenerateMode(true);
              setFlowMode('form');
            }}
            className="w-full p-4 rounded-2xl glass-card text-left flex items-start gap-4 hover:border-pink-500/30 transition-all cursor-pointer group"
          >
            <div className="p-3 bg-pink-500/10 text-pink-400 rounded-xl shrink-0 group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-200 group-hover:text-pink-300 transition-colors">
                Generate digital QR label
              </h3>
              <p className="text-xs text-slate-400 leading-normal">
                Auto-generate a unique label coded with metadata (owner name, UUID, and bin title). View and save/print it on success.
              </p>
            </div>
          </button>
        </div>

      </div>
    );
  }

  // 2. DIGITAL QR SUCCESS RECEIPT SCREEN
  if (successBin && generatedQrText) {
    return (
      <div className="w-full max-w-4xl mx-auto py-6 px-4 space-y-6 relative overflow-hidden">
        {/* Confetti-like glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-600/10 rounded-full blur-3xl"></div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onBack()}
            className="p-2 -ml-1 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
            aria-label="Back to Search"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="p-3 bg-emerald-500/10 rounded-full text-emerald-400 w-fit mx-auto mb-2">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-lg font-bold text-slate-200">Bin Successfully Registered!</h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Your digital QR code is ready. Screenshot or print it to attach to your storage bin.
          </p>
        </div>

        {/* QR Code display */}
        <div className="bg-white p-4 rounded-2xl w-fit mx-auto shadow-2xl border border-slate-200">
          <img 
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(generatedQrText)}`} 
            alt="Bin QR Code" 
            className="w-[180px] h-[180px] object-contain"
          />
        </div>

        {/* Details list */}
        <div className="space-y-3 text-left">
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800/80 space-y-2 text-xs">
            <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
              <span className="text-slate-400 font-semibold">Name</span>
              <span className="text-slate-200 font-bold">{successBin.name || 'Untitled Bin'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
              <span className="text-slate-400 font-semibold">Location</span>
              <span className="text-slate-200">{successBin.location || 'Unknown Location'}</span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 font-semibold block">Unique Scanned Text</span>
              <div className="bg-slate-950 p-2.5 rounded-lg font-mono text-[9px] text-purple-300 break-all select-all border border-slate-800/50">
                {generatedQrText}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={() => onPrintBin(generatedQrText, successBin.name)}
            className="flex-1 py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg cursor-pointer active:scale-98 transition-all"
          >
            <Printer className="w-4 h-4" /> Print Label
          </button>
          <button
            onClick={() => onNavigate('bin-details', { binId: successBin.id })}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 transition-all"
          >
            Go to Details <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    );
  }

  // 3. CREATE BIN FORM
  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 relative overflow-hidden">
      {/* Glow decoration */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="p-5 flex items-center gap-3 border-b border-slate-800/50">
        <button
          onClick={() => {
            if (qrId) {
              onNavigate('scanner');
            } else {
              setFlowMode('choice');
              setGenerateMode(false);
            }
          }}
          className="p-2 -ml-1 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-200">Register New Bin</h1>
            <p className="text-[10px] text-slate-400">
              {generateMode 
                ? 'Seeding with digital QR code generation' 
                : <>QR: <span className="font-mono text-purple-300">{qrId}</span></>}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Photo capture container */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Bin Photo
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
                    disabled={!cameraReady || compressing || loading}
                    className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Snap Photo
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
                <img src={imagePreview} alt="Bin Preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-slate-950/65 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity gap-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startInlineCamera(); }}
                    className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" /> Retake (Camera)
                  </button>
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
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
                <div className="flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startInlineCamera(); }}
                    className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Start Camera
                  </button>
                  <button
                    type="button"
                    onClick={triggerFilePicker}
                    className="px-4 py-2.5 bg-slate-900 border border-slate-800/80 text-slate-300 hover:text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    Select File
                  </button>
                </div>
                <span className="block text-[10px] text-slate-500">Snap directly in browser or upload an existing file</span>
              </div>
            )}
          </div>
        </div>

        {/* Form details */}
        <div className="space-y-4">
          <div>
            <label htmlFor="binName" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Bin Name
            </label>
            <div className="relative">
              <Box className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input
                id="binName"
                type="text"
                placeholder="e.g. Winter Clothing"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500"
                disabled={loading}
              />
            </div>
          </div>

           <div>
            <label htmlFor="binLoc" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input
                id="binLoc"
                type="text"
                placeholder="e.g. Basement Shelf A"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setShowLocationDropdown(true);
                }}
                onFocus={() => setShowLocationDropdown(true)}
                className="w-full pl-10 pr-4 py-3 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500"
                disabled={loading}
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
                    .filter(loc => loc.toLowerCase().includes(location.toLowerCase()))
                    .map(loc => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => {
                          setLocation(loc);
                          setShowLocationDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs text-slate-350 hover:bg-purple-600/25 hover:text-white transition-colors block"
                      >
                        {loc}
                      </button>
                    ))}
                  {allLocations.filter(loc => loc.toLowerCase().includes(location.toLowerCase())).length === 0 && (
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
                      onClick={() => setLocation(loc)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                        location.toLowerCase() === loc.toLowerCase()
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

        {error && (
          <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || compressing}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {generateMode ? 'Generate QR & Save' : 'Save & Register Bin'}
        </button>
      </form>

    </div>
  );
}
