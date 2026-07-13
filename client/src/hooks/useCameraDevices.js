import { useState, useEffect, useCallback } from 'react';

/**
 * Enumerates available video input devices and exposes a helper to cycle
 * through them. Consumers still own starting/stopping the MediaStream so
 * the return shape stays serializable and testable.
 *
 * @returns {{
 *   devices: MediaDeviceInfo[],
 *   currentDeviceId: string,
 *   switchCamera: () => string | void,
 *   hasMultipleCameras: boolean
 * }}
 */
export function useCameraDevices() {
  const [devices, setDevices] = useState([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');

  useEffect(() => {
    let mounted = true;

    const enumerate = async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (!mounted) return;

        const videoDevices = allDevices.filter(
          (device) => device.kind === 'videoinput' && device.deviceId
        );

        setDevices(videoDevices);
        setCurrentDeviceId((prev) => {
          if (prev && videoDevices.some((d) => d.deviceId === prev)) {
            return prev;
          }
          return videoDevices[0]?.deviceId || '';
        });
      } catch (err) {
        console.error('enumerateDevices failed:', err);
      }
    };

    if (!navigator.mediaDevices) return;

    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);

    return () => {
      mounted = false;
      navigator.mediaDevices.removeEventListener('devicechange', enumerate);
    };
  }, []);

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return currentDeviceId;

    const idx = devices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextIdx = (idx + 1) % devices.length;
    const nextDeviceId = devices[nextIdx].deviceId;
    setCurrentDeviceId(nextDeviceId);
    return nextDeviceId;
  }, [devices, currentDeviceId]);

  const hasMultipleCameras = devices.length >= 2;

  return { devices, currentDeviceId, switchCamera, hasMultipleCameras };
}
