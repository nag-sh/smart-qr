import React, { useEffect, useRef, useState } from 'react';
import { Camera, SwitchCamera } from 'lucide-react';
import { useCameraDevices } from '../hooks/useCameraDevices';

export default function InlineCamera(props) {
  const {
    onCapture,
    captureFileName = 'capture.jpg',
    useInlineCamera,
    onTriggerFilePicker,
    snapButtonLabel = 'Snap',
    uploadButtonLabel = 'Upload File',
    startingText = 'Camera starting...',
    unsupportedMessage = 'WebRTC camera not supported. Opening standard file selector.',
    blockedMessage = 'Camera access blocked. Opening file selector...'
  } = props;

  // onStartCamera is accepted for API symmetry but is not used directly; the parent
  // toggles useInlineCamera to enter/exit the camera view.

  const { hasMultipleCameras } = useCameraDevices();
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState(null);
  const [shutterFlash, setShutterFlash] = useState(false);

  const videoRef = useRef(null);
  const usingFrontCamera = useRef(false);

  // Stop camera tracks when the camera is hidden or the component unmounts.
  useEffect(() => {
    if (!useInlineCamera && cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
      setCameraReady(false);
    }
  }, [useInlineCamera, cameraStream]);

  // Start the camera whenever the component is active and no stream is held.
  useEffect(() => {
    if (!useInlineCamera) return;
    if (cameraStream) return;

    let cancelled = false;

    const startCamera = async (facingMode = 'environment') => {
      setCameraReady(false);
      setCapturedFrame(null);
      setShutterFlash(false);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error(unsupportedMessage);
        onTriggerFilePicker();
        return;
      }

      const baseConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
      let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, ...baseConstraints }
      });
    } catch (err) {
      console.error('Failed to get preferred camera:', err);
      const fallbackFacingMode = facingMode === 'environment' ? 'user' : 'environment';
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: fallbackFacingMode, ...baseConstraints }
          });
        } catch (fallbackErr) {
          console.error('Failed to get camera stream:', fallbackErr);
          onTriggerFilePicker();
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      setCameraStream(stream);
    };

    startCamera();

    return () => {
      cancelled = true;
    };
  }, [useInlineCamera, cameraStream, onTriggerFilePicker, unsupportedMessage, blockedMessage]);

  // Hook the active stream up to the video element.
  useEffect(() => {
    if (useInlineCamera && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [useInlineCamera, cameraStream]);

  const handleSwitchCamera = () => {
    setCameraReady(false);
    usingFrontCamera.current = !usingFrontCamera.current;
    const facingMode = usingFrontCamera.current ? 'user' : 'environment';
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    // The start effect will re-run with the new facingMode because cameraStream
    // was nulled. The ref holds the facing-mode preference for the next start.
    void facingMode;
  };

  const handleVideoReady = () => {
    const video = videoRef.current;
    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      setCameraReady(true);
    }
  };

  const capturePhoto = (e) => {
    if (e) e.stopPropagation();
    const video = videoRef.current;
    if (!video || !cameraReady || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
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
          return;
        }
        const file = new File([blob], captureFileName, { type: 'image/jpeg' });
        await onCapture(file);
      }, 'image/jpeg', 0.85);
    } catch (err) {
      console.error('Capture frame error:', err);
      onTriggerFilePicker();
    }
  };

  return (
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
            {startingText}
          </span>
        </div>
      )}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-2 z-20">
        <button
          type="button"
          onClick={capturePhoto}
          disabled={!cameraReady}
          className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
        >
          <Camera className="w-4 h-4" /> {snapButtonLabel}
        </button>
        <button
          type="button"
          onClick={onTriggerFilePicker}
          className="px-4 py-2.5 bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold cursor-pointer"
        >
          {uploadButtonLabel}
        </button>
      </div>
    </>
  );
}
