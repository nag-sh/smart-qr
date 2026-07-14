import React from 'react';
import { ArrowLeft } from 'lucide-react';

export default function BackButton({
  onClick,
  className = '',
  disabled = false,
  'aria-label': ariaLabel = 'Go back',
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'p-2 rounded-xl bg-slate-900/60 border border-slate-800/80',
        'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
        'transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      ].join(' ')}
      aria-label={ariaLabel}
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
}
