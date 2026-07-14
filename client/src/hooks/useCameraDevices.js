import { useState, useEffect } from 'react';

/**
 * Enumerates available video input devices to determine whether the device
 * has more than one camera. Consumers own starting/stopping the MediaStream
 * and should use `facingMode` toggling to switch cameras.
 *
 * @returns {{ hasMultipleCameras: boolean }}
 */
export function useCameraDevices() {
  const [hasMultipleCameras, setHasMultiple] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (!mounted) return;

        const count = allDevices.filter(
          (device) => device.kind === 'videoinput' && device.deviceId
        ).length;
        setHasMultiple(count >= 2);
      } catch (err) {
        // Ignore enumeration errors; the camera may still work via facingMode.
      }
    };

    if (navigator.mediaDevices) {
      check();
      navigator.mediaDevices.addEventListener('devicechange', check);
      return () => {
        mounted = false;
        navigator.mediaDevices.removeEventListener('devicechange', check);
      };
    }
  }, []);

  return { hasMultipleCameras };
}
