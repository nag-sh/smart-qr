import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PhotoUploadArea from '../PhotoUploadArea';

describe('PhotoUploadArea', () => {
  afterEach(() => {
    cleanup();
  });

  const baseProps = {
    fileInputRef: { current: null },
    onFileChange: vi.fn(),
    onCapture: vi.fn(),
    onStartCamera: vi.fn(),
    onTriggerFilePicker: vi.fn(),
    captureFileName: 'capture.jpg'
  };

  it('renders the default empty state with start/select buttons', () => {
    render(<PhotoUploadArea {...baseProps} label="Photo" />);
    expect(screen.getByText('Photo')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
    expect(screen.getByText('Start Camera')).toBeInTheDocument();
    expect(screen.getByText('Select File')).toBeInTheDocument();
  });

  it('renders the inline camera when active', () => {
    render(<PhotoUploadArea {...baseProps} useInlineCamera />);
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(screen.getByText('Camera starting...')).toBeInTheDocument();
  });

  it('renders the photo preview with retake/upload buttons', () => {
    render(
      <PhotoUploadArea
        {...baseProps}
        imagePreview="blob://preview"
        previewAlt="Item preview"
      />
    );
    expect(screen.getByAltText('Item preview')).toBeInTheDocument();
    expect(screen.getByText('Retake Camera')).toBeInTheDocument();
    expect(screen.getByText('Upload File')).toBeInTheDocument();
  });

  it('renders the compressing state', () => {
    render(<PhotoUploadArea {...baseProps} compressing />);
    expect(screen.getByText('Optimizing photo...')).toBeInTheDocument();
  });

  it('renders a custom empty state when provided', () => {
    render(
      <PhotoUploadArea
        {...baseProps}
        emptyState={<div>Custom empty placeholder</div>}
      />
    );
    expect(screen.getByText('Custom empty placeholder')).toBeInTheDocument();
    expect(screen.queryByText('Start Camera')).not.toBeInTheDocument();
  });

  it('renders the image-source chooser overlay when provided', () => {
    render(
      <PhotoUploadArea
        {...baseProps}
        imageSourceChooser={<div>Choose photo source</div>}
      />
    );
    expect(screen.getByText('Choose photo source')).toBeInTheDocument();
  });
});
