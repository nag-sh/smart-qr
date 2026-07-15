import React, { useEffect, useRef, useState } from 'react';
import { Camera, SwitchCamera } from 'lucide-react';
import { useCameraDevices } from '../hooks/useCameraDevices';

export default function InlineCamera(props) {
  const {
    onCapture,
    onCapturePreview,
    captureFileName = 'capture.jpg',
    useInlineCamera,
    onTriggerFilePicker,
    snapButtonLabel = 'Snap',
    uploadButtonLabel = 'Upload File',
    startingText = 'Camera starting...',
    unsupportedMessage = 'WebRTC camera not supported. Opening standard file selector.',
    blockedMessage = 'Camera access blocked. Opening file selector...',
    showCapturedFrame = true
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
  const streamRef = useRef(null);

  // Keep the latest onTriggerFilePicker without making it a dependency of the
  // camera-start effect (see below) — otherwise every parent re-render (which
  // recreates this inline callback) would cancel and restart getUserMedia.
  const onTriggerFilePickerRef = useRef(onTriggerFilePicker);
  onTriggerFilePickerRef.current = onTriggerFilePicker;

  // Stop camera tracks when the camera is hidden or the component unmounts.
  useEffect(() => {
    if (!useInlineCamera && cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
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
        onTriggerFilePickerRef.current();
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
          onTriggerFilePickerRef.current();
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      setCameraStream(stream);
      streamRef.current = stream;
    };

    startCamera(usingFrontCamera.current ? 'user' : 'environment');

    return () => {
      cancelled = true;
    };
  }, [useInlineCamera, cameraStream]);

  // Release the camera when the component unmounts (e.g., the modal is closed).
  // Toggling useInlineCamera to false also stops the tracks (above), but in
  // multi-add the camera is always active while mounted, so the only reliable
  // signal that we're done with it is unmount — without this the OS shows the
  // camera as still in use.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Hook the active stream up to the video element.
  useEffect(() => {
    if (useInlineCamera && videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [useInlineCamera, cameraStream]);

  const handleSwitchCamera = () => {
    setCameraReady(false);
    usingFrontCamera.current = !usingFrontCamera.current;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraStream(null);
    }
    // Nulling the stream re-triggers the start effect, which reads usingFrontCamera.current for the new facing mode.
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
      const MAX_DIM = 1280;
      const longSide = Math.max(video.videoWidth, video.videoHeight);
      const scale = longSide > MAX_DIM ? MAX_DIM / longSide : 1;
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 300);

      const captureId = crypto.randomUUID();

      // Instant preview: a synchronous data URL so the roll card paints on the
      // very next frame with zero async-encode wait. The canvas is capped at
      // 1280px, so this encode is only a few-dozen ms — far cheaper than the old
      // full-res toDataURL that froze the UI for 1-2s before navigation could start.
      const previewUrl = canvas.toDataURL('image/jpeg', 0.7);
      if (showCapturedFrame) setCapturedFrame(previewUrl);
      if (onCapturePreview) onCapturePreview(previewUrl, captureId);

      canvas.toBlob((blob) => {
        if (!blob) {
          onTriggerFilePicker();
          return;
        }
        const file = new File([blob], captureFileName, { type: 'image/jpeg' });
        // Emit onCapture AFTER onCapturePreview: multi-add creates the preview
        // card in onCapturePreview and looks it up here, so the card must exist
        // first or the capture silently no-ops and hangs on "Analyzing".
        onCapture(file, captureId);
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
        onPlaying={handleVideoReady}
      />
      {showCapturedFrame && capturedFrame && (
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
