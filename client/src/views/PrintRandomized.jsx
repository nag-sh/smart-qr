import React, { useState } from 'react';
import { ArrowLeft, Printer, QrCode } from 'lucide-react';

const LABEL_PRESETS = [
  {
    id: 'avery-22805',
    name: 'Avery 22805',
    labelSize: '1.5" × 1.5" square',
    pageSize: 'letter',
    pageWidth: 8.5,
    pageHeight: 11,
    cols: 4,
    rows: 6,
    labelWidth: 1.5,
    labelHeight: 1.5,
    marginTop: 0.6875,
    marginRight: 1.0625,
    marginBottom: 0.6875,
    marginLeft: 1.0625,
    gapX: 0.125,
    gapY: 0.125,
    perPage: 24,
  },
  {
    id: 'avery-22806',
    name: 'Avery 22806',
    labelSize: '2" × 2" square',
    pageSize: 'letter',
    pageWidth: 8.5,
    pageHeight: 11,
    cols: 3,
    rows: 4,
    labelWidth: 2,
    labelHeight: 2,
    marginTop: 0.75,
    marginRight: 0.75,
    marginBottom: 0.75,
    marginLeft: 0.75,
    gapX: 0.5,
    gapY: 0.5,
    perPage: 12,
  },
  {
    id: 'avery-94104',
    name: 'Avery 94104',
    labelSize: '2.5" × 2.5" square',
    pageSize: 'letter',
    pageWidth: 8.5,
    pageHeight: 11,
    cols: 3,
    rows: 3,
    labelWidth: 2.5,
    labelHeight: 2.5,
    marginTop: 1.0,
    marginRight: 0.375,
    marginBottom: 1.0,
    marginLeft: 0.375,
    gapX: 0.125,
    gapY: 0.75,
    perPage: 9,
  },
];

export default function PrintRandomized({ onBack, onPrintRandom }) {
  const [layout, setLayout] = useState(LABEL_PRESETS[1]); // default 2"×2" square

  const handleSubmit = (e) => {
    e.preventDefault();
    const codes = Array.from({ length: layout.perPage }, () => crypto.randomUUID());
    onPrintRandom({ codes, layout });
    onBack();
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 space-y-6 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 -ml-1 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-cyan-500/10 rounded-xl text-cyan-400">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-200">Print Randomized QR Codes</h1>
            <p className="text-[10px] text-slate-400">Square Avery label sheets</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Label sheet
          </label>
          <div className="grid grid-cols-1 gap-3">
            {LABEL_PRESETS.map((option) => {
              const selected = option.id === layout.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLayout(option)}
                  className={[
                    'flex items-center gap-4 rounded-xl p-3 border transition-all cursor-pointer text-left',
                    selected
                      ? 'bg-cyan-500/10 border-cyan-400 ring-2 ring-cyan-400'
                      : 'bg-slate-900/40 border-slate-700 hover:border-slate-600',
                  ].join(' ')}
                  aria-pressed={selected}
                >
                  <div className="w-16 aspect-[8.5/11] shrink-0 rounded-md bg-slate-800/60 p-1">
                    <div
                      className="w-full h-full"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${option.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${option.rows}, 1fr)`,
                        gap: '1px',
                      }}
                    >
                      {Array.from({ length: option.cols * option.rows }).map((_, i) => (
                        <div key={i} className="rounded-[1px] bg-slate-300/70" />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${selected ? 'text-cyan-400' : 'text-slate-300'}`}>
                      {option.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {option.labelSize} &middot; {option.perPage}/sheet
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          Print Page
        </button>
      </form>
    </div>
  );
}
