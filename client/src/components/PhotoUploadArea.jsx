import React from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import InlineCamera from './InlineCamera';

export default function PhotoUploadArea(props) {
  const {
    label,
    labelClassName = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider',
    fileInputRef,
    onFileChange,
    imagePreview,
    previewAlt = 'Preview',
    compressing,
    useInlineCamera,
    onCapture,
    captureFileName,
    onStartCamera,
    onTriggerFilePicker,
    snapButtonLabel = 'Snap',
    uploadButtonLabel = 'Upload File',
    startButtonLabel = 'Start Camera',
    selectButtonLabel = 'Select File',
    retakeButtonLabel = 'Retake Camera',
    helperText,
    helperTextClassName = 'block text-[9px] text-slate-500 max-w-[240px] mx-auto leading-normal',
    emptyState,
    imageSourceChooser,
    containerClassName,
    onContainerClick,
    retakeButtonClassName = 'px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer',
    previewUploadButtonClassName = 'px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-[10px] font-bold rounded-xl flex items-center gap-1.5 cursor-pointer',
    previewGapClass = 'gap-2.5',
    startButtonClassName = 'px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer',
    selectButtonClassName = 'px-4 py-2 bg-slate-900 border border-slate-800/80 text-slate-300 hover:text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer',
    emptyLayout = 'vertical'
  } = props;

  const emptyLayoutClass =
    emptyLayout === 'horizontal'
      ? 'flex justify-center gap-3'
      : 'flex flex-col gap-2 px-4 w-full max-w-[240px]';

  const defaultEmptyState = (
    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 text-center text-slate-400 p-4">
      <div className={emptyLayoutClass}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartCamera();
          }}
          className={startButtonClassName}
        >
          <Camera className="w-4 h-4" /> {startButtonLabel}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTriggerFilePicker();
          }}
          className={selectButtonClassName}
        >
          {selectButtonLabel}
        </button>
      </div>
      {helperText && (
        <span className={helperTextClassName}>
          {helperText}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {label && (
        <label className={labelClassName}>
          {label}
        </label>
      )}
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={onFileChange}
        className="hidden"
      />
      <div
        className={`relative bg-slate-950 overflow-hidden rounded-2xl ${
          useInlineCamera ? 'aspect-video' : `aspect-square ${containerClassName || ''}`
        }`}
        onClick={!useInlineCamera ? onContainerClick : undefined}
      >
        {useInlineCamera ? (
          <InlineCamera
            onCapture={onCapture}
            captureFileName={captureFileName}
            useInlineCamera={useInlineCamera}
            onStartCamera={onStartCamera}
            onTriggerFilePicker={onTriggerFilePicker}
            snapButtonLabel={snapButtonLabel}
            uploadButtonLabel={uploadButtonLabel}
          />
        ) : imagePreview ? (
          <>
            <img src={imagePreview} alt={previewAlt} className="w-full h-full object-cover" />
            <div
              className={`absolute inset-0 bg-slate-950/65 opacity-0 hover:opacity-100 flex flex-col items-center justify-center transition-opacity ${previewGapClass}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCamera();
                }}
                className={retakeButtonClassName}
              >
                <Camera className="w-3.5 h-3.5" /> {retakeButtonLabel}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerFilePicker();
                }}
                className={previewUploadButtonClassName}
              >
                {uploadButtonLabel}
              </button>
            </div>
          </>
        ) : compressing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-center text-slate-400 text-xs">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-purple-400" />
            <span>Optimizing photo...</span>
          </div>
        ) : (
          emptyState || defaultEmptyState
        )}
        {imageSourceChooser}
      </div>
    </div>
  );
}
