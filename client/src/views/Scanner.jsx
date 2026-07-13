import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Camera as CameraIcon, CameraOff, QrCode, AlertCircle, ArrowRight, Keyboard, RefreshCw, ArrowLeft } from 'lucide-react';
import { getBin } from '../services/storage';

export default function Scanner({ onNavigate, onBack }) {
  const [scanResult, setScanResult] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualQr, setManualQr] = useState('');
  const [loading, setLoading] = useState(false);
  const html5QrCodeRef = useRef(null);

  // Initialize qr scanner instance
  useEffect(() => {
    html5QrCodeRef.current = new Html5Qrcode('scanner-viewport');
    
    // Automatically trigger scan on load
    startScanner();

    return () => {
      stopScanner();
    };
  }, []);

  const startScanner = async () => {
    setError('');
    setScanResult('');
    try {
      if (html5QrCodeRef.current) {
        // If already scanning, stop first
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }

        if (Capacitor.isNativePlatform()) {
          try {
            const permissionResult = await Camera.requestPermissions();
            if (permissionResult.camera === 'denied') {
              setError('Camera permission is required to scan QR codes. Please enable it in app settings.');
              setIsScanning(false);
              return;
            }
          } catch (permissionErr) {
            console.error('Camera permission request failed:', permissionErr);
            setError('Could not request camera permission. Please allow camera access in app settings.');
            setIsScanning(false);
            return;
          }
        }

        await html5QrCodeRef.current.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.65;
              return { width: size, height: size };
            }
          },
          (decodedText) => {
            handleScanSuccess(decodedText);
          },
          (errorMessage) => {
            // Quietly ignore typical scanning frame noise
          }
        );
        setIsScanning(true);
      }
    } catch (err) {
      console.error('Failed to start scanning:', err);
      setError('Could not access camera. Ensure permission is granted and HTTPS is configured.');
      setIsScanning(false);
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

  const handleScanSuccess = async (qrId) => {
    // Vibrate device on success if supported
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
      // Query storage abstraction
      const { bin } = await getBin(trimmed);
      onNavigate('bin-details', { binId: bin.id });
    } catch (err) {
      if (err.message === 'Bin not found') {
        // New QR Code -> Route to Create Bin
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
      {/* Glow Effects */}
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Viewport Header */}
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
            onClick={() => {
              stopScanner();
              setManualMode(!manualMode);
            }}
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

      {/* Scanner Viewport / Manual Entry */}
      <div className="relative bg-slate-950 aspect-square flex items-center justify-center overflow-hidden">
        {manualMode ? (
          /* Manual QR Code Entry form */
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
          /* Camera Viewport */
          <>
            {/* HTML5 Qrcode library attaches canvas element here */}
            <div id="scanner-viewport" className="w-full h-full object-cover"></div>

            {/* Custom scanning HUD overlays */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* Blur masks around the target area */}
                <div className="absolute inset-0 bg-slate-950/40"></div>
                
                {/* Square target box */}
                <div className="w-[65%] aspect-square border-2 rounded-2xl animate-qr-pulse relative z-10">
                  {/* Glowing corners */}
                  <div className="absolute -top-[3px] -left-[3px] w-6 h-6 border-t-4 border-l-4 border-purple-500 rounded-tl-xl"></div>
                  <div className="absolute -top-[3px] -right-[3px] w-6 h-6 border-t-4 border-r-4 border-purple-500 rounded-tr-xl"></div>
                  <div className="absolute -bottom-[3px] -left-[3px] w-6 h-6 border-b-4 border-l-4 border-purple-500 rounded-bl-xl"></div>
                  <div className="absolute -bottom-[3px] -right-[3px] w-6 h-6 border-b-4 border-r-4 border-purple-500 rounded-br-xl"></div>
                  
                  {/* Laser line anim */}
                  <div className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-lg shadow-pink-500/50 animate-scan-line"></div>
                </div>
              </div>
            )}

            {/* Offline/Stopped state overlay */}
            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4 bg-slate-900/80 z-20">
                <div className="p-3.5 bg-slate-800/80 rounded-full text-slate-400">
                  <CameraOff className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-slate-200">Scanner Paused</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Camera access is inactive. Tap below to reactivate camera.
                  </p>
                </div>
                <button
                  onClick={startScanner}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <CameraIcon className="w-3.5 h-3.5" /> Start Camera
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Feedback / Error Messages */}
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
