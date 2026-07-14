import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

const VARIANTS = {
  error: {
    container: 'bg-red-500/10 border-red-500/20 text-red-300',
    icon: AlertCircle,
    iconCls: 'text-red-400'
  },
  success: {
    container: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    icon: CheckCircle2,
    iconCls: 'text-emerald-400'
  },
  info: {
    container: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
    icon: Info,
    iconCls: 'text-blue-400'
  }
};

export default function MessageBanner({ type = 'error', children, className = '', centered = false }) {
  const variant = VARIANTS[type] || VARIANTS.error;
  const Icon = variant.icon;

  return (
    <div
      className={`p-3.5 border rounded-xl flex items-start gap-2 text-xs ${centered ? 'justify-center text-center' : ''} ${variant.container} ${className}`}
      role={type === 'error' ? 'alert' : 'status'}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${variant.iconCls} ${centered ? 'animate-none' : 'animate-pulse'}`} />
      <span>{children}</span>
    </div>
  );
}
