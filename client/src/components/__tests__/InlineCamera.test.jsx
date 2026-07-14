import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import InlineCamera from '../InlineCamera';

describe('InlineCamera', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
        }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the video element and starting indicator', () => {
    render(
      <InlineCamera
        useInlineCamera
        onCapture={vi.fn()}
        onTriggerFilePicker={vi.fn()}
      />
    );
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(screen.getByText('Camera starting...')).toBeInTheDocument();
  });

  it('captures a photo and passes a File to onCapture', async () => {
    const onCapture = vi.fn();
    const onTriggerFilePicker = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['fake-image'], { type: 'image/jpeg' }));
    });

    render(
      <InlineCamera
        useInlineCamera
        onCapture={onCapture}
        onTriggerFilePicker={onTriggerFilePicker}
        captureFileName="test-capture.jpg"
      />
    );

    const video = document.querySelector('video');
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    fireEvent.loadedData(video);

    await waitFor(() => {
      expect(screen.queryByText('Camera starting...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /snap/i }));

    await waitFor(() => {
      expect(onCapture).toHaveBeenCalledTimes(1);
    });

    const file = onCapture.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test-capture.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('falls back to the file picker when the camera is unsupported', async () => {
    const onTriggerFilePicker = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: undefined });

    render(
      <InlineCamera
        useInlineCamera
        onCapture={vi.fn()}
        onTriggerFilePicker={onTriggerFilePicker}
      />
    );

    await waitFor(() => {
      expect(onTriggerFilePicker).toHaveBeenCalled();
    });
  });
});
