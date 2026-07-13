import React, { useState, useEffect, useRef } from 'react';
import { Camera } from '@capacitor/camera';
import { Camera as CameraIcon, CameraOff, QrCode, AlertCircle, ArrowRight, Keyboard, RefreshCw, ArrowLeft, SwitchCamera } from 'lucide-react';
import { getBin } from '../services/storage';
import { useCameraDevices } from '../hooks/useCameraDevices';

const decodeInterval = 200; // 5 fps decode; tunable

export default function Scanner({ onNavigate, onBack }) {
  const { devices, currentDeviceId, switchCamera, hasMultipleCameras } = useCameraDevices();
  const [scanResult, setScanResult] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualQr, setManualQr] = useState('');
  const [loading, setLoading] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const decodeTimerRef = useRef(null);
  const decodeFrameRef = useRef(null);
  const startingRef = useRef(false);
  const scanningRef = useRef(false);
  const handleScanSuccessRef = useRef(handleScanSuccess);

  handleScanSuccessRef.current = handleScanSuccess;

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/qrWorker.js', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      if (scanningRef.current && e.data) {
        handleScanSuccessRef.current(e.data);
      }
    };
    return () => {
      cleanupScanner();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (manualMode) {
      stopScanner();
    } else {
      startScanner();
    }
  }, [manualMode]);

  function cleanupScanner() {
    if (decodeTimerRef.current) {
      clearTimeout(decodeTimerRef.current);
      decodeTimerRef.current = null;
    }
    if (decodeFrameRef.current) {
      cancelAnimationFrame(decodeFrameRef.current);
      decodeFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    scanningRef.current = false;
  }

  const startScanner = async (deviceId = currentDeviceId) => {
    if (startingRef.current || !videoRef.current || !workerRef.current) return;
    startingRef.current = true;
    cleanupScanner();
    setError('');
    setScanResult('');

    const baseVideo = {
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 30, min: 30 },
    };

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, ...baseVideo }
          : { facingMode: 'environment', ...baseVideo },
        audio: false,
      });
    } catch (err) {
      if (deviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', ...baseVideo },
            audio: false,
          });
        } catch (fallbackErr) {
          console.error('Failed to start camera:', fallbackErr);
          setIsScanning(false);
          setError('Could not access camera. Please ensure camera permission is granted.');
          startingRef.current = false;
          return;
        }
      } else {
        console.error('Failed to start camera:', err);
        setIsScanning(false);
        setError('Could not access camera. Please ensure camera permission is granted.');
        startingRef.current = false;
        return;
      }
    }

    try {
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setIsScanning(true);
      scanningRef.current = true;
      scheduleDecode();
    } catch (playErr) {
      console.error('Failed to play video:', playErr);
      setIsScanning(false);
      setError('Could not start camera preview.');
    } finally {
      startingRef.current = false;
    }
  };

  const stopScanner = () => {
    cleanupScanner();
    setIsScanning(false);
  };

  const handleSwitchCamera = () => {
    const nextDeviceId = switchCamera();
    startScanner(nextDeviceId);
  };

  const scheduleDecode = () => {
    const capture = () => {
      if (!scanningRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !workerRef.current || video.paused || video.ended) return;
      if (video.readyState < 2) {
        decodeFrameRef.current = requestAnimationFrame(capture);
        return;
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, vw, vh);
      const imageData = ctx.getImageData(0, 0, vw, vh);
      workerRef.current.postMessage({ width: imageData.width, height: imageData.height, data: imageData.data }, [imageData.data.buffer]);
    };

    const loop = () => {
      if (!scanningRef.current) return;
      capture();
      decodeTimerRef.current = setTimeout(() => {
        decodeFrameRef.current = requestAnimationFrame(loop);
      }, decodeInterval);
    };

    decodeFrameRef.current = requestAnimationFrame(loop);
  };

  const decodeImageData = (imageData) => {
    return new Promise((resolve) => {
      const worker = new Worker(new URL('../workers/qrWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        resolve(e.data);
        worker.terminate();
      };
      worker.onerror = (err) => {
        console.error('Photo decode worker error:', err);
        resolve(null);
        worker.terminate();
      };
      worker.postMessage(
        { width: imageData.width, height: imageData.height, data: imageData.data },
        [imageData.data.buffer]
      );
    });
  };

  const takePhotoAndScan = async () => {
    setError('');
    setScanResult('');
    setLoading(true);
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: 'DataUrl',
        correctOrientation: true,
      });

      const image = new Image();
      image.src = photo.dataUrl;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const text = await decodeImageData(imageData);
      if (!text) {
        setError('No QR code found in that photo. Please try again.');
        return;
      }
      await handleScanSuccess(text);
    } catch (err) {
      console.error('Native photo scan failed:', err);
      const message = err?.message?.toLowerCase() || '';
      if (message.includes('cancel') || message.includes('user did not select')) {
        return;
      }
      if (message.includes('denied') || message.includes('permission')) {
        setError('Camera permission is required to scan QR codes. Please enable it in app settings.');
        return;
      }
      setError('No QR code found in that photo. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  async function handleScanSuccess(qrId) {
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
    setScanResult(qrId);
    await stopScanner();
    lookupQrCode(qrId);
  }

  const lookupQrCode = async (qrId) => {
    const trimmed = qrId.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const { bin } = await getBin(trimmed);
      onNavigate('bin-details', { binId: bin.id });
    } catch (err) {
      if (err.message === 'Bin not found') {
        onNavigate('create-bin', { qrId: trimmed });
      } else {
        setError(err.message || 'Error processing scanned QR code');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualQr.trim()) return;
    lookupQrCode(manualQr);
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 space-y-6 relative overflow-hidden">
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="p-5 flex items-center gap-3 border-b border-slate-800/50">
        <button
          onClick={onBack}
          aria-label="Back to Search"
          className="p-2 -ml-1 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <QrCode className="w-5 h-5 text-purple-400" />
          <h1 className="font-bold text-sm text-slate-200">Scan QR Code</h1>
        </div>
        <button
          onClick={() => setManualMode(!manualMode)}
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700/60 hover:bg-slate-800/50 text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          {manualMode ? (
            <>
              <CameraIcon className="w-3.5 h-3.5" /> Use Camera
            </>
          ) : (
            <>
              <Keyboard className="w-3.5 h-3.5" /> Manual Entry
            </>
          )}
        </button>
      </div>

      <div className="relative bg-slate-950 aspect-square flex items-center justify-center overflow-hidden rounded-3xl">
        {manualMode ? (
          <form onSubmit={handleManualSubmit} className="w-full px-6 py-8 space-y-4 max-w-xs text-center z-10">
            <div className="p-3 bg-purple-500/10 rounded-2xl text-purple-400 w-fit mx-auto mb-2">
              <Keyboard className="w-8 h-8" />
            </div>
            <h2 className="text-sm font-semibold text-slate-300">Enter QR code text</h2>
            <input
              type="text"
              placeholder="e.g. BIN-001"
              value={manualQr}
              onChange={(e) => setManualQr(e.target.value)}
              className="w-full px-4 py-3 rounded-xl glass-input text-center font-mono text-sm tracking-wide"
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !manualQr.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-medium text-sm flex items-center justify-center gap-2 active:scale-98 transition-transform cursor-pointer"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Lookup Code
            </button>
          </form>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas
              ref={canvasRef}
              className="absolute opacity-0 pointer-events-none size-0"
            />

            {isScanning && hasMultipleCameras && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                aria-label="Switch camera"
                className="absolute bottom-4 right-4 z-30 p-2.5 rounded-full bg-slate-900/80 border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            )}

            {isScanning && (
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute inset-0"
                  style={{
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    background: 'rgba(2,6,23,0.3)',
                    WebkitMaskImage:
                      'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwMDAiIGQ9Ik03IDAgSDkzIEE3IDcgMCAwIDEgMTAwIDcgVjkzIEE3IDcgMCAwIDEgOTMgMTAwIEg3IEE3IDcgMCAwIDEgMCA5MyBWNyBBNyA3IDAgMCAxIDcgMCBaIE0xNSAxMCBIODUgQTUgNSAwIDAgMSA5MCAxNSBWODUgQTUgNSAwIDAgMSA4NSA5MCBIMTUgQTUgNSAwIDAgMSAxMCA4NSBWMTUgQTUgNSAwIDAgMSAxNSAxMCBaIi8+PC9zdmc+")',
                    maskImage:
                      'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIj48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwMDAiIGQ9Ik03IDAgSDkzIEE3IDcgMCAwIDEgMTAwIDcgVjkzIEE3IDcgMCAwIDEgOTMgMTAwIEg3IEE3IDcgMCAwIDEgMCA5MyBWNyBBNyA3IDAgMCAxIDcgMCBaIE0xNSAxMCBIODUgQTUgNSAwIDAgMSA5MCAxNSBWODUgQTUgNSAwIDAgMSA4NSA5MCBIMTUgQTUgNSAwIDAgMSAxMCA4NSBWMTUgQTUgNSAwIDAgMSAxNSAxMCBaIi8+PC9zdmc+")',
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                  }}
                />

                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative w-[80%] aspect-square border-2 border-purple-500/60 rounded-2xl animate-qr-pulse">
                    <div className="absolute -top-[3px] -left-[3px] w-6 h-6 border-t-4 border-l-4 border-purple-500 rounded-tl-xl"></div>
                    <div className="absolute -top-[3px] -right-[3px] w-6 h-6 border-t-4 border-r-4 border-purple-500 rounded-tr-xl"></div>
                    <div className="absolute -bottom-[3px] -left-[3px] w-6 h-6 border-b-4 border-l-4 border-purple-500 rounded-bl-xl"></div>
                    <div className="absolute -bottom-[3px] -right-[3px] w-6 h-6 border-b-4 border-r-4 border-purple-500 rounded-br-xl"></div>
                    <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                      <div className="absolute left-1 right-1 top-0 h-full scan-line-gradient animate-scan-sweep"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4 bg-slate-900/80 z-20">
                <div className="p-3.5 bg-slate-800/80 rounded-full text-slate-400">
                  <CameraOff className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-200">{error ? 'Camera Error' : 'Scanner Paused'}</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    {error || 'Camera access is inactive. Tap below to reactivate camera.'}
                  </p>
                </div>
                <button
                  onClick={startScanner}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <CameraIcon className="w-3.5 h-3.5" /> Start Camera
                </button>
                <button
                  onClick={takePhotoAndScan}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CameraIcon className="w-3.5 h-3.5" />}
                  {loading ? 'Scanning…' : 'Take Photo Instead'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {(error || scanResult) && (
        <div className="p-4 border-t border-slate-800/50">
          {error && (
            <div className="flex gap-2.5 text-xs text-red-300 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}
          {scanResult && (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Scanned QR: <strong className="font-mono text-emerald-400">{scanResult}</strong>. Processing...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
