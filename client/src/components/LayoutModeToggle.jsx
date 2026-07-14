import React from 'react';
import { LayoutGrid, List, Image as ImageIcon } from 'lucide-react';

const MODES = ['thumbnail', 'detailed', 'gallery'];

const VARIANTS = {
  search: {
    container: 'flex bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 gap-1 shrink-0',
    buttonBase: 'p-2.5 rounded-lg transition-colors cursor-pointer',
    active: 'bg-purple-600 text-white shadow shadow-purple-950/20',
    inactive: 'text-slate-500 hover:text-slate-300',
    labels: {
      thumbnail: 'Thumbnail Grid Mode',
      detailed: 'Detailed List Mode',
      gallery: 'Gallery Mode',
    },
    ariaLabels: true,
  },
  binDetails: {
    container: 'flex bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 gap-1.5 shrink-0',
    buttonBase: 'p-2 rounded-lg transition-colors cursor-pointer',
    active: 'bg-purple-655 text-white shadow shadow-purple-900/20',
    inactive: {
      thumbnail: 'text-slate-505 hover:text-slate-300',
      detailed: 'text-slate-550 hover:text-slate-300',
      gallery: 'text-slate-550 hover:text-slate-300',
    },
    labels: {
      thumbnail: 'Thumbnail Grid',
      detailed: 'Detailed List',
      gallery: 'Gallery Mode',
    },
    ariaLabels: false,
  },
};

export default function LayoutModeToggle({ mode, onChange, storageKey, variant = 'search' }) {
  const config = VARIANTS[variant] || VARIANTS.search;

  const handleChange = (next) => {
    if (next === mode) return;
    onChange?.(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // ignore localStorage write errors
      }
    }
  };

  return (
    <div className={config.container}>
      {MODES.map((key) => {
        const active = mode === key;
        const inactiveClass =
          typeof config.inactive === 'string'
            ? config.inactive
            : config.inactive[key];
        const title = config.labels[key];
        const ariaLabel = config.ariaLabels ? title : undefined;
        return (
          <button
            key={key}
            type="button"
            onClick={() => handleChange(key)}
            className={`${config.buttonBase} ${active ? config.active : inactiveClass}`}
            title={title}
            aria-label={ariaLabel}
            aria-pressed={active}
          >
            {key === 'thumbnail' && <LayoutGrid className="w-5 h-5" />}
            {key === 'detailed' && <List className="w-5 h-5" />}
            {key === 'gallery' && <ImageIcon className="w-5 h-5" />}
          </button>
        );
      })}
    </div>
  );
}
