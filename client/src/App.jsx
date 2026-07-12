import React, { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QrCode, Settings as SettingsIcon, Printer, Info, X } from 'lucide-react';

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
function ModalShell({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/30 backdrop-blur-md"
      onClick={onClose}
    >
      <div className="w-[92%] sm:w-auto max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-panel-modal w-full max-h-[90vh] overflow-y-auto rounded-3xl relative animate-in fade-in zoom-in-95 duration-200">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-all cursor-pointer z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
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

  // Modal state: single-slot overlay above the persistent Search base
  const [activeModal, setActiveModal] = useState(null); // { type, params } | null

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

  // Bridge: same (viewName, params) interface views already use → modal state
  const onNavigate = (viewName, params = {}) => {
    if (viewName === 'search') {
      setActiveModal(null);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    setActiveModal({ type: viewName, params });
    window.scrollTo({ top: 0, behavior: 'instant' });
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

  const renderModal = () => {
    if (!activeModal) return null;

    const { type, params = {} } = activeModal;

    return (
      <ModalShell onClose={() => onNavigate('search')}>
        {type === 'scanner' && <Scanner onNavigate={onNavigate} />}
        {type === 'create-bin' && (
          <CreateBin
            qrId={params.qrId}
            onNavigate={onNavigate}
            onPrintBin={handlePrintBin}
          />
        )}
        {type === 'bin-details' && (
          <BinDetails
            binId={params.binId}
            onNavigate={onNavigate}
            onPrintBin={handlePrintBin}
          />
        )}
        {type === 'item-details' && (
          <ItemDetails itemId={params.itemId} onNavigate={onNavigate} />
        )}
        {type === 'add-item' && (
          <AddItem binId={params.binId} onNavigate={onNavigate} />
        )}
        {type === 'settings' && <Settings onNavigate={onNavigate} />}
        {type === 'restore-points' && <RestorePoints onNavigate={onNavigate} />}
      </ModalShell>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-28 text-slate-100 flex flex-col justify-between">
      {/* Main Content Area — Search is always the base view */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-2">
        <Search onNavigate={onNavigate} />
      </main>

      {/* Glassy modal overlay for all non-search views */}
      {renderModal()}

      {/* Floating Bottom Navigation Bar (Hidden when printing label) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-40 no-print">
        <nav className="glass-panel px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-around gap-2 border border-slate-800/80">

          {/* Scanner Tab */}
          <button
            onClick={() => onNavigate('scanner')}
            className={`flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              activeModal?.type === 'scanner'
                ? 'text-purple-400 bg-purple-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Scan</span>
          </button>

          {/* Settings Tab */}
          <button
            onClick={() => onNavigate('settings')}
            className={`flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              activeModal?.type === 'settings' || activeModal?.type === 'restore-points'
                ? 'text-purple-400 bg-purple-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <SettingsIcon className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Settings</span>
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
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
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
