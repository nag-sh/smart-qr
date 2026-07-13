import { useState, useEffect } from 'react';
import { isImageRef, resolveImageUrl } from '../services/localImages';

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
    resolveImageUrl(value).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return src;
}
