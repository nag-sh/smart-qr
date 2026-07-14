import React from 'react';
import { Camera, SwitchCamera, Upload } from 'lucide-react';

export default function InlineCamera({
  videoRef,
  cameraReady,
  capturedFrame,
  shutterFlash,
  hasMultipleCameras,
  onCapture,
  onSwitchCamera,
  onUpload,
  onVideoReady,
  captureLabel = 'Snap',
  uploadLabel = 'Upload File',
  disabled = false
}) {
  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
        onLoadedData={onVideoReady}
        onLoadedMetadata={onVideoReady}
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
          onClick={onSwitchCamera}
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
          onClick={onCapture}
          disabled={!cameraReady || disabled}
          className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
        >
          <Camera className="w-4 h-4" /> {captureLabel}
        </button>
        <button
          type="button"
          onClick={onUpload}
          className="px-4 py-2.5 bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Upload className="w-4 h-4" /> {uploadLabel}
        </button>
      </div>
    </>
  );
}
