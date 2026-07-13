import { useEffect, useRef } from 'react';

const EDGE = 28;
const MIN_SWIPE = 60;

export function useEdgeGestures(rootRef, { onBack, onOpenFilters, filtersOpen, onSearchScreen }) {
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

      const screenWidth = window.innerWidth;
      const fromLeftEdge = start.x <= EDGE;
      const fromRightEdge = start.x >= screenWidth - EDGE;

      if (filtersOpen && dx > 0) {
        e.preventDefault();
        onBack();
      } else if (fromLeftEdge && dx > 0) {
        e.preventDefault();
        onBack();
      } else if (fromRightEdge && dx < 0 && onSearchScreen && !filtersOpen) {
        e.preventDefault();
        onOpenFilters();
      }
    };

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart, { passive: true });
      root.removeEventListener('touchend', handleTouchEnd, { passive: false });
    };
  }, [rootRef, onBack, onOpenFilters, filtersOpen, onSearchScreen]);
}
