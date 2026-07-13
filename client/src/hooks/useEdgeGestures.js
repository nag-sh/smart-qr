import { useEffect, useRef } from 'react';

const EDGE = 28;
const MIN_SWIPE = 60;

export function useEdgeGestures(rootRef, { onBack }) {
  const startRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const isHorizontalSwipe = (dx, dy) => Math.abs(dx) >= MIN_SWIPE && Math.abs(dx) > Math.abs(dy);

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      startRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (e) => {
      const start = startRef.current;
      if (!start) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (!isHorizontalSwipe(dx, dy)) return;

      if (start.x <= EDGE && dx > 0) {
        e.preventDefault();
        onBack();
      }
    };

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart, { passive: true });
      root.removeEventListener('touchend', handleTouchEnd, { passive: false });
    };
  }, [rootRef, onBack]);
}
