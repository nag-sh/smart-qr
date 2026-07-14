import { useState, useEffect } from 'react';
import { isImageRef, resolveImageUrl, releaseImageUrl } from '../services/localImages';

export default function useImageSrc(value) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!value) {
      setSrc(null);
      return;
    }
    if (!isImageRef(value)) {
      setSrc(value);
      return;
    }
    let cancelled = false;
    const currentRef = value;
    resolveImageUrl(currentRef).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
      releaseImageUrl(currentRef);
    };
  }, [value]);

  return src;
}
