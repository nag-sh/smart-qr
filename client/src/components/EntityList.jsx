import React, { useEffect, useRef, useMemo } from 'react';
import { Box, Package, MapPin, Tag, CheckSquare, Square } from 'lucide-react';
import useImageSrc from '../hooks/useImageSrc';

const OBSERVER_MARGIN = '150px';

function EntityImage({ url, alt, className }) {
  const src = useImageSrc(url);
  return src ? <img src={src} alt={alt} className={className} loading="lazy" /> : null;
}

function EntityList({
  entities = [],
  layoutMode = 'thumbnail',
  manageMode = false,
  selectedIds = new Set(),
  onSelectToggle,
  onEntryClick,
  onLongPress,
  onLoadMore,
  hasMore = false,
  loading = false,
  emptyMessage = 'No entries found.',
  typeLabels = { bin: 'Bin', item: 'Item' },
}) {
  const observerTargetRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressStart = useRef(null);
  const suppressClick = useRef(false);

  const LONG_PRESS_DURATION = 500;
  const LONG_PRESS_MOVE_THRESHOLD = 10;

  const sortedEntities = useMemo(() => {
    if (layoutMode !== 'gallery') return entities;
    return [...entities].sort((a, b) => {
      const aHasImage = a.image_url ? 1 : 0;
      const bHasImage = b.image_url ? 1 : 0;
      return bHasImage - aHasImage;
    });
  }, [entities, layoutMode]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && onLoadMore) {
          onLoadMore();
        }
      },
      { root: null, rootMargin: OBSERVER_MARGIN, threshold: 0.1 }
    );

    const currentTarget = observerTargetRef.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loading, onLoadMore, sortedEntities.length]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  const startLongPress = (entry) => (e) => {
    if (e.button !== 0) return;
    const target = e.currentTarget;
    longPressStart.current = { x: e.clientX, y: e.clientY, target };
    target.style.touchAction = 'none';
    target.style.userSelect = 'none';
    if (target.setPointerCapture) target.setPointerCapture(e.pointerId);
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      if (onLongPress) onLongPress(entry);
    }, LONG_PRESS_DURATION);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressStart.current && longPressStart.current.target) {
      longPressStart.current.target.style.touchAction = '';
      longPressStart.current.target.style.userSelect = '';
    }
    longPressStart.current = null;
  };

  const moveLongPress = (e) => {
    if (!longPressTimer.current || !longPressStart.current) return;
    const dx = e.clientX - longPressStart.current.x;
    const dy = e.clientY - longPressStart.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
      cancelLongPress();
    }
  };

  const handleCheckboxChange = (entry) => (e) => {
    e.stopPropagation();
    if (onSelectToggle) {
      const nextChecked = !selectedIds.has(entry.id);
      onSelectToggle(entry, nextChecked);
    }
  };

  const renderCheckbox = (entry) => {
    if (!manageMode) return null;
    const isSelected = selectedIds.has(entry.id);
    return (
      <button
        onClick={handleCheckboxChange(entry)}
        className="shrink-0 p-1 rounded hover:bg-slate-800/50 transition-colors z-10"
        title={isSelected ? 'Deselect' : 'Select'}
      >
        {isSelected ? (
          <CheckSquare className="w-4 h-4 text-purple-400" />
        ) : (
          <Square className="w-4 h-4 text-slate-400" />
        )}
      </button>
    );
  };

  const handleEntryClick = (entry) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (manageMode) {
      if (onSelectToggle) {
        onSelectToggle(entry, !selectedIds.has(entry.id));
      }
      return;
    }
    if (onEntryClick) {
      onEntryClick(entry);
    }
  };

  const renderTypeIcon = (type, className = 'w-5 h-5 text-slate-700 stroke-1') => {
    const label = typeLabels[type] ?? type;
    return type === 'bin' ? (
      <Box className={className} title={label} />
    ) : (
      <Package className={className} title={label} />
    );
  };

  const renderThumbnail = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {sortedEntities.map((entry) => (
        <div
          key={entry.id}
          onClick={handleEntryClick(entry)}
          onPointerDown={startLongPress(entry)}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerMove={moveLongPress}
          className="glass-card rounded-2xl overflow-hidden flex flex-col justify-between h-full cursor-pointer hover:shadow-xl hover:border-slate-700/50 transition-all animate-fade-in relative"
        >
          {manageMode && (
            <div className="absolute top-2 left-2 z-10">
              {renderCheckbox(entry)}
            </div>
          )}
          {entry.type === 'bin' ? (
            <>
              <div className="relative h-[110px] bg-slate-900 flex items-center justify-center overflow-hidden">
                {entry.image_url ? (
                  <EntityImage
                    url={entry.image_url}
                    alt={entry.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  renderTypeIcon(entry.type, 'w-10 h-10 text-slate-750 stroke-1')
                )}
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-800 text-[10px] font-semibold text-purple-300">
                  {entry.item_count} items
                </span>
              </div>
              <div className="p-4 space-y-1.5">
                <h3 className="font-bold text-sm text-slate-100 truncate">{entry.name}</h3>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <MapPin className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                  <span className="truncate">{entry.location}</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="relative h-[140px] bg-slate-900 flex items-center justify-center overflow-hidden group">
                {entry.image_url ? (
                  <EntityImage
                    url={entry.image_url}
                    alt={entry.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  renderTypeIcon(entry.type, 'w-10 h-10 text-slate-700 stroke-1')
                )}
                  <button
                    onClick={handleEntryClick(entry)}
                    className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded-lg bg-slate-950/85 hover:bg-slate-950 border border-slate-800/50 text-[10px] text-slate-300 flex items-center justify-between transition-colors shadow-lg"
                  >
                    <span className="flex items-center gap-1 font-medium truncate max-w-[65%]">
                      <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="truncate">{entry.bin_name}</span>
                    </span>
                    <span className="flex items-center gap-0.5 text-slate-400 truncate max-w-[35%]">
                      <MapPin className="w-3 h-3 text-pink-400 shrink-0" />
                      <span className="truncate">{entry.bin_location}</span>
                    </span>
                  </button>
                </div>
                <div className="p-4 space-y-1.5">
                  <h3 className="font-bold text-sm text-slate-100 leading-snug line-clamp-1">{entry.name}</h3>
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {entry.description || 'No description provided.'}
                  </p>
                </div>
              </div>
              <div className="px-4 pb-4">
                {entry.search_tags && entry.search_tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-[48px] overflow-hidden">
                    {entry.search_tags.slice(0, 3).map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[9px] text-purple-300 flex items-center gap-0.5"
                      >
                        <Tag className="w-2.5 h-2.5 text-purple-400" />
                        {tag}
                      </span>
                    ))}
                    {entry.search_tags.length > 3 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-[9px] text-slate-400">
                        +{entry.search_tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const renderDetailed = () => (
    <div className="space-y-2.5">
      {sortedEntities.map((entry) => (
        <div
          key={entry.id}
          onClick={handleEntryClick(entry)}
          onPointerDown={startLongPress(entry)}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerMove={moveLongPress}
          className="glass-card rounded-2xl p-3 flex items-center justify-between gap-4 hover:bg-slate-900/65 cursor-pointer transition-all border border-slate-800/40 hover:border-slate-750 animate-fade-in"
        >
          <div className="flex items-center gap-3 min-w-0">
            {renderCheckbox(entry)}
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
              {entry.image_url ? (
                <EntityImage
                  url={entry.image_url}
                  alt={entry.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                renderTypeIcon(entry.type, 'w-5 h-5 text-slate-700 stroke-1')
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-slate-200 truncate">{entry.name}</h3>
              {entry.type === 'bin' ? (
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500">
                  <MapPin className="w-3 h-3 text-pink-400 shrink-0" />
                  <span className="truncate">{entry.location}</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 truncate mt-0.5 max-w-[200px] sm:max-w-md">
                  {entry.description || 'No description provided.'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-right">
            {entry.type === 'bin' ? (
              <>
                <div className="hidden sm:block text-[10px] text-slate-500 font-mono">
                  QR: <span className="text-slate-350">{entry.qr_id && entry.qr_id.length > 8 ? entry.qr_id.slice(0, 8) + '...' : entry.qr_id}</span>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] font-bold text-purple-300">
                  {entry.item_count} items
                </span>
              </>
            ) : (
              <>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] font-bold text-purple-300 flex items-center gap-1">
                    <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    {entry.bin_name}
                  </span>
                  <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
                    <MapPin className="w-2.5 h-2.5 text-pink-400" />
                    {entry.bin_location}
                  </span>
                </div>
                {entry.search_tags && entry.search_tags.length > 0 && (
                  <div className="hidden md:flex items-center gap-1">
                    {entry.search_tags.slice(0, 2).map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-1.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[8px] text-purple-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderGallery = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {sortedEntities.map((entry) => (
        <div
          key={entry.id}
          onClick={handleEntryClick(entry)}
          onPointerDown={startLongPress(entry)}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerMove={moveLongPress}
          className="aspect-square bg-slate-900 border border-slate-800/80 rounded-2xl overflow-hidden relative group cursor-pointer hover:border-purple-500/40 transition-colors animate-fade-in"
        >
          {manageMode && (
            <div className="absolute top-2 left-2 z-10">
              {renderCheckbox(entry)}
            </div>
          )}
          {entry.image_url ? (
            <EntityImage
              url={entry.image_url}
              alt={entry.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-1.5 bg-slate-950/20 animate-pulse">
              {renderTypeIcon(entry.type, 'w-7 h-7 text-slate-700 stroke-1')}
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">No Photo</span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent flex flex-col justify-end text-left">
            <h3 className="font-bold text-xs text-slate-100 truncate leading-snug">{entry.name}</h3>
            {entry.type === 'bin' ? (
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[9px] text-slate-400 truncate flex items-center gap-0.5">
                  <MapPin className="w-2.5 h-2.5 text-pink-400 shrink-0" />
                  <span className="truncate">{entry.location}</span>
                </span>
                <span className="text-[9px] font-bold text-purple-300 shrink-0 leading-none">
                  {entry.item_count} items
                </span>
              </div>
            ) : (
              <p className="text-[9px] text-slate-400 truncate mt-0.5 leading-none">
                {entry.description || 'No description'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderLoading = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="glass-card rounded-2xl h-[280px] p-4 flex flex-col justify-between animate-pulse"
        >
          <div className="w-full h-[140px] bg-slate-800/40 rounded-xl mb-3"></div>
          <div className="space-y-2">
            <div className="h-4 bg-slate-800/40 rounded-md w-3/4"></div>
            <div className="h-3 bg-slate-800/40 rounded-md w-5/6"></div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderEmpty = () => (
    <div className="glass-panel rounded-2xl py-16 px-4 text-center">
      <Package className="w-12 h-12 text-slate-500 mx-auto mb-4 stroke-1" />
      <h3 className="text-slate-300 font-semibold mb-1">{emptyMessage}</h3>
    </div>
  );

  if (loading && entities.length === 0) {
    return (
      <div className="space-y-4">
        {renderLoading()}
        <div ref={observerTargetRef} className="h-1.5" />
      </div>
    );
  }

  if (entities.length === 0) {
    return renderEmpty();
  }

  return (
    <div className="space-y-4">
      {layoutMode === 'thumbnail' && renderThumbnail()}
      {layoutMode === 'detailed' && renderDetailed()}
      {layoutMode === 'gallery' && renderGallery()}
      {loading && entities.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div ref={observerTargetRef} className="h-1.5" />
    </div>
  );
}

export default React.memo(EntityList);
