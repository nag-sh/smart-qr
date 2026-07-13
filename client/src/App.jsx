import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, useSearchParams, useNavigate } from 'react-router-dom';
import { parseModalStack, stackToSearchString } from './modalStack.js';
import { QrCode, Settings as SettingsIcon, Printer, Info, ArrowLeft, Plus } from 'lucide-react';

// Import Views
import Search from './views/Search';
import Scanner from './views/Scanner';
import CreateBin from './views/CreateBin';
import BinDetails from './views/BinDetails';
import ItemDetails from './views/ItemDetails';
import AddItem from './views/AddItem';
import Settings from './views/Settings';
import RestorePoints from './views/RestorePoints';

// ─── Glassy modal shell (rendered above Search + bottom nav) ───────────────
function ModalShell({ onClose, hideClose = false, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/30 backdrop-blur-md"
      onClick={onClose}
    >
      <div className="w-[92%] sm:w-auto max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-panel-modal w-full max-h-[90vh] overflow-y-auto rounded-3xl relative animate-in fade-in zoom-in-95 duration-200">
          {!hideClose && (
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back to Search"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Inner App Content (must be inside BrowserRouter) ───────────────────────
function AppContent() {
  // Print state
  const [printData, setPrintData] = useState(null); // { qr_id, name }
  const [showPrintHelper, setShowPrintHelper] = useState(false);
  const [printCountdown, setPrintCountdown] = useState(5);

  // Modal stack: derived from the URL (?modal=...&...) so it is linkable/layered
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stack = parseModalStack(searchParams);
  const modalTypes = stack.map(l => l.type);

  // Auto-close print helper popup after 5 seconds to stay out of the user's way
  useEffect(() => {
    let interval;
    if (showPrintHelper) {
      setPrintCountdown(5);
      interval = setInterval(() => {
        setPrintCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setShowPrintHelper(false);
            setPrintData(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showPrintHelper]);

  // How many modal layers this session pushed onto history. The in-app back
  // button pops during normal navigation, but falls back to the parent stack URL
  // when the modal was opened via a direct load / reload / shared link — there is
  // no prior entry then, so navigate(-1) would exit the app or get stuck.
  const pushDepth = useRef(0);

  const onNavigate = (viewName, params = {}) => {
    if (viewName === 'search') {
      navigate('/');
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const newStack = [...stack, { type: viewName, params }];
    navigate({ search: stackToSearchString(newStack) });
    pushDepth.current += 1;
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const onBack = () => {
    if (pushDepth.current > 0) {
      pushDepth.current -= 1;
      navigate(-1);
    } else {
      const parentSearch = stackToSearchString(stack.slice(0, -1));
      navigate(parentSearch ? { search: parentSearch } : '/');
    }
  };

  // central printing trigger
  const handlePrintBin = (qrId, binName) => {
    setPrintData({ qr_id: qrId, name: binName });
    setShowPrintHelper(true);
    // Give browser brief time to draw print-label-only DOM container
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const renderModalStack = () => {
    if (stack.length === 0) return null;
    return stack.map((layer, i) => {
      const { type, params } = layer;
      const hideClose = ['restore-points', 'bin-details', 'item-details', 'add-item', 'create-bin'].includes(type);
      const isLast = i === stack.length - 1;

      let view;
      switch (type) {
        case 'scanner': view = <Scanner onNavigate={onNavigate} onBack={onBack} />; break;
        case 'create-bin': view = <CreateBin qrId={params.qrId} onNavigate={onNavigate} onBack={onBack} onPrintBin={handlePrintBin} />; break;
        case 'bin-details': view = <BinDetails binId={params.binId} onNavigate={onNavigate} onBack={onBack} onPrintBin={handlePrintBin} modalTypes={modalTypes} />; break;
        case 'item-details': view = <ItemDetails itemId={params.itemId} onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} />; break;
        case 'add-item': view = <AddItem binId={params.binId} onNavigate={onNavigate} onBack={onBack} />; break;
        case 'settings': view = <Settings onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} />; break;
        case 'restore-points': view = <RestorePoints onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} />; break;
        default: return null;
      }

      return (
        <div key={i} style={{ position: 'fixed', inset: 0, zIndex: 50 + i, pointerEvents: isLast ? 'auto' : 'none' }}>
          <ModalShell onClose={onBack} hideClose={hideClose}>
            {view}
          </ModalShell>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-28 text-slate-100 flex flex-col justify-between">
      {/* Main Content Area — Search is always the base view */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-2">
        <Search onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} />
      </main>

      {/* Glassy modal overlay for all non-search views */}
      {renderModalStack()}

      {/* Floating Bottom Navigation Bar (Hidden when printing label) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-40 no-print">
        <nav className="glass-panel px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-around gap-2 border border-slate-800/80">

          {/* Scanner Tab */}
          <button
            onClick={() => onNavigate('scanner')}
            className={`flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              stack[stack.length - 1]?.type === 'scanner'
                ? 'text-purple-400 bg-purple-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Scan</span>
          </button>

          {/* Quick Add Tab */}
          <button
            onClick={() => onNavigate('quick-add')}
            className="flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer text-slate-400 hover:text-slate-200"
          >
            <Plus className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Add</span>
          </button>

        </nav>
      </div>

      {/* 4. ON-SCREEN PRINT HELPER MODAL OVERLAY (Visible on screen, excluded from printed page) */}
      {showPrintHelper && printData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm no-print">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-800 relative text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => {
                setShowPrintHelper(false);
                setPrintData(null);
              }}
              className="absolute top-4 left-4 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back to Search"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="p-3 bg-purple-500/10 rounded-full text-purple-400 w-fit mx-auto">
              <Printer className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-slate-200">Printing Label</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                The native print dialog has been triggered. Please ensure paper size is set to <strong>8.5" x 11" (Letter)</strong> and orientation is <strong>Landscape</strong>.
              </p>
            </div>

            {/* Android Settings printer deep-link fallback */}
            <div className="bg-slate-900/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2 text-left">
              <div className="flex gap-2 text-[10px] text-slate-400 items-start">
                <Info className="w-3.5 h-3.5 text-pink-400 shrink-0 mt-0.5" />
                <span>
                  Having trouble finding your printer? Android users can configure locally networked printer drivers (HP, Mopria, etc.) in System Settings.
                </span>
              </div>
              <a
                href="intent://#Intent;action=android.settings.PRINT_SETTINGS;end"
                className="w-full py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1 transition-all cursor-pointer shadow-md"
              >
                <SettingsIcon className="w-3.5 h-3.5" /> Configure Android Printers
              </a>
            </div>

            <button
              onClick={() => {
                setShowPrintHelper(false);
                setPrintData(null);
              }}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-bold transition-all cursor-pointer"
            >
              Dismiss ({printCountdown}s)
            </button>
          </div>
        </div>
      )}

      {/* 5. HIDDEN PRINT CONTAINER (Targeted by media print styles, excluded on screen layout) */}
      {printData && (
        <div className="print-label-only hidden">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(printData.qr_id)}`}
            alt="Print QR Label"
            className="print-qr-code"
          />
          <h1 className="print-bin-name">{printData.name}</h1>
        </div>
      )}
    </div>
  );
}

// ─── Root App (BrowserRouter wrapper) ──────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
