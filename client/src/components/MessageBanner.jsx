import React from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, X } from 'lucide-react';

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
};

const STYLES = {
  error: 'p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-300',
  success: 'p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300',
  warning: 'p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2.5 text-xs text-amber-300',
};

export default function MessageBanner({
  type = 'error',
  message,
  onClose,
  className,
  icon: Icon,
  iconClassName = 'w-4 h-4 shrink-0 mt-0.5',
}) {
  const DefaultIcon = ICONS[type] || AlertCircle;
  const IconComponent = Icon || DefaultIcon;
  return (
    <div className={className || STYLES[type]} role="status">
      <IconComponent className={iconClassName} />
      <div className="flex-1 min-w-0">{message}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-1 -m-1 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
