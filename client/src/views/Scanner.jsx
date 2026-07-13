import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera } from '@capacitor/camera';
import { Camera as CameraIcon, CameraOff, QrCode, AlertCircle, ArrowRight, Keyboard, RefreshCw, ArrowLeft } from 'lucide-react';
import { getBin } from '../services/storage';

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new File([u8arr], filename, { type: mime });
}

export default function Scanner({ onNavigate, onBack }) {
  const [scanResult, setScanResult] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualQr, setManualQr] = useState('');
  const [loading, setLoading] = useState(false);
  const html5QrCodeRef = useRef(null);
  const startingRef = useRef(false);

  useEffect(() => {
    html5QrCodeRef.current = new Html5Qrcode('scanner-viewport');
    return () => {
      stopScanner();
    };
  }, []);

  useEffect(() => {
    if (manualMode) {
      stopScanner();
    } else {
      startScanner();
    }
  }, [manualMode]);

  const startScanner = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError('');
    setScanResult('');
    try {
      const qr = html5QrCodeRef.current;
      if (qr) {
        if (qr.isScanning) {
          await qr.stop();
        }
        await qr.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.65;
              return { width: size, height: size };
            },
            videoConstraints: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          (decodedText) => {
            handleScanSuccess(decodedText);
          },
          () => {}
        );
        setIsScanning(true);
      }
    } catch (err) {
      console.error('Failed to start scanning:', err);
      setIsScanning(false);
      setError('Could not access camera. Please ensure camera permission is granted.');
      try {
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
      } catch (e) {
        /* ignore reset errors */
      }
    } finally {
      startingRef.current = false;
    }
  };

  const stopScanner = async () => {
    try {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop();
        setIsScanning(false);
      }
    } catch (err) {
      console.error('Failed to stop scanning:', err);
    }
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
        correctOrientation: true
      });
      const file = dataURLtoFile(photo.dataUrl, 'qr-scan.jpg');
      const text = await html5QrCodeRef.current.scanFile(file, false);
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

  const handleScanSuccess = async (qrId) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
    setScanResult(qrId);
    await stopScanner();
    lookupQrCode(qrId);
  };

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
    <div className="w-full max-w-md mx-auto py-6 px-4 space-y-6 relative overflow-hidden">
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

      <div className="relative bg-slate-950 aspect-square flex items-center justify-center overflow-hidden">
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
            <div id="scanner-viewport" className="w-full h-full object-cover"></div>

            {isScanning && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="absolute inset-0 bg-slate-950/40"></div>
                <div className="w-[65%] aspect-square border-2 border-purple-500/60 rounded-2xl animate-qr-pulse relative z-10">
                  <div className="absolute -top-[3px] -left-[3px] w-6 h-6 border-t-4 border-l-4 border-purple-500 rounded-tl-xl"></div>
                  <div className="absolute -top-[3px] -right-[3px] w-6 h-6 border-t-4 border-r-4 border-purple-500 rounded-tr-xl"></div>
                  <div className="absolute -bottom-[3px] -left-[3px] w-6 h-6 border-b-4 border-l-4 border-purple-500 rounded-bl-xl"></div>
                  <div className="absolute -bottom-[3px] -right-[3px] w-6 h-6 border-b-4 border-r-4 border-purple-500 rounded-br-xl"></div>
                  <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                    <div className="absolute left-1 right-1 top-0 h-full scan-line-gradient animate-scan-sweep"></div>
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
