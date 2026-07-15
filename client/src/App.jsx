import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, useSearchParams, useNavigate } from 'react-router-dom';
import { parseModalStack, stackToSearchString, dedupeStack } from './modalStack.js';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useEdgeGestures } from './hooks/useEdgeGestures.js';
import { Print } from './plugins/print.js';
import { QrCode, Settings as SettingsIcon, Printer, Info, Plus, Search as SearchIcon } from 'lucide-react';
import BackButton from './components/BackButton';
import MessageBanner from './components/MessageBanner';

// Import Views
import Search from './views/Search';
import Scanner from './views/Scanner';
import CreateBin from './views/CreateBin';
import BinDetails from './views/BinDetails';
import ItemDetails from './views/ItemDetails';
import ItemForm from './views/ItemForm';
import Settings from './views/Settings';
import RestorePoints from './views/RestorePoints';
import PrintRandomized from './views/PrintRandomized';
import MultiAddModal from './views/MultiAddModal';
import QRCode from 'qrcode';

// ─── Glassy modal shell (rendered above Search + bottom nav) ───────────────
function ModalShell({ onClose, hideClose = false, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-950/30 backdrop-blur-md"
      onClick={onClose}
    >
      <div className="w-full sm:w-[96%] sm:max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="glass-panel-modal w-full max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-3xl relative animate-in fade-in zoom-in-95 duration-200">
          {!hideClose && (
            <BackButton
              onClick={onClose}
              className="absolute top-4 left-4"
              aria-label="Back to Search"
            />
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Inner App Content (must be inside BrowserRouter) ───────────────────────
function AppContent() {
  // Modal stack: derived from the URL (?modal=...&...) so it is linkable/layered.
  // Declared FIRST because the scroll-lock effect below reads `stack` in its
  // dependency array — referencing it before this `const` hits the temporal
  // dead zone and crashes at render time (ReferenceError: Cannot access
  // 'stack' before initialization).
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stack = dedupeStack(parseModalStack(searchParams));
  const modalTypes = stack.map(l => l.type);

  // ─── Prevent body scroll when modal is open ──────────────────────────
  useEffect(() => {
    if (stack.length > 0) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [stack.length]);

  // Print state
  const [printData, setPrintData] = useState(null); // { qr_id, name }
  const [showPrintHelper, setShowPrintHelper] = useState(false);
  const [printCountdown, setPrintCountdown] = useState(5);
  const [printError, setPrintError] = useState('');
  const [randomPrintData, setRandomPrintData] = useState(null); // { codes: string[], perPage: number }

  const [refreshNonce, setRefreshNonce] = useState(0);
  const bumpRefresh = () => setRefreshNonce((n) => n + 1);

  // Auto-close print helper popup after 5 seconds to stay out of the user's way
  useEffect(() => {
    let interval;
    if (showPrintHelper) {
      setPrintCountdown(5);
      interval = setInterval(() => {
        setPrintCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            if (!printError) {
              setShowPrintHelper(false);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showPrintHelper, printError]);

  // Android's print adapter rasterizes the final page only after the user
  // confirms in the system dialog, so the print DOM must outlive print(). The
  // native side emits 'printComplete' on a terminal job state; clear the
  // (hidden) print containers then. Without this, the page prints blank.
  useEffect(() => {
    const listener = Print.addListener('printComplete', () => {
      setRandomPrintData(null);
      setPrintData(null);
      setShowPrintHelper(false);
    });
    return () => {
      listener.then((handle) => handle.remove());
    };
  }, []);

  // How many modal layers this session pushed onto history. The in-app back
  // button pops during normal navigation, but falls back to the parent stack URL
  // when the modal was opened via a direct load / reload / shared link — there is
  // no prior entry then, so navigate(-1) would exit the app or get stuck.
  const pushDepth = useRef(0);

  const onNavigate = (viewName, params = {}, options = {}) => {
    if (viewName === 'search') {
      if (params.location) {
        navigate('/?filterLocation=' + encodeURIComponent(params.location));
      } else {
        navigate('/');
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    // resetStack: collapse the whole modal stack to just this view. Used when
    // snapping a new item — the prior stack (bin → add-item) should give way to
    // the loading + details screen, not stay stacked behind it. Back from here
    // returns to the root (home) rather than re-opening the source modals.
    if (options.resetStack) {
      const newStack = [{ type: viewName, params }];
      navigate({ search: stackToSearchString(newStack) }, { replace: true });
      pushDepth.current = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    if (options.replace) {
      const newStack = [...stack, { type: viewName, params }];
      navigate({ search: stackToSearchString(newStack) }, { replace: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    // One unique modal type at a time. If the target type is already in the
    // stack, returning to it is equivalent to pressing the back button, so we
    // pop back to that existing instance instead of stacking a duplicate.
    const existingIdx = stack.findIndex((l) => l.type === viewName);
    if (existingIdx >= 0) {
      if (existingIdx < stack.length - 1) {
        bumpRefresh();
        const layersToPop = stack.length - 1 - existingIdx;
        if (pushDepth.current >= layersToPop) {
          pushDepth.current -= layersToPop;
          navigate(-layersToPop);
        } else {
          const targetSearch = stackToSearchString(stack.slice(0, existingIdx + 1));
          navigate(targetSearch ? { search: targetSearch } : '/');
        }
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    const newStack = [...stack, { type: viewName, params }];
    navigate({ search: stackToSearchString(newStack) });
    pushDepth.current += 1;
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const onBack = () => {
    bumpRefresh();
    if (pushDepth.current > 0) {
      pushDepth.current -= 1;
      navigate(-1);
    } else {
      const parentSearch = stackToSearchString(stack.slice(0, -1));
      navigate(parentSearch ? { search: parentSearch } : '/');
    }
  };

  const rootRef = useRef(null);
  useEdgeGestures(rootRef, { onBack });

  // Android system back gesture → same in-app back the edge-swipe uses, so a
  // left-edge swipe always pops one modal layer instead of closing the app
  // (the OS default). Registering the listener disables that default. On web
  // the browser owns back, so skip entirely.
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let handle;
    let cancelled = false;
    CapacitorApp.addListener('backButton', () => {
      if (stack.length > 0) onBack();
      else CapacitorApp.exitApp();
    }).then((h) => { if (!cancelled) handle = h; });
    return () => { cancelled = true; handle?.remove(); };
  }, [stack.length, onBack]);

  // central printing trigger
  const handlePrintBin = async (qrId, binName) => {
    // Avoid the two print containers ever coexisting in print media.
    setRandomPrintData(null);
    setPrintError('');
    setShowPrintHelper(true);

    let dataUrl = '';
    try {
      dataUrl = await QRCode.toDataURL(qrId, {
        width: 1000,
        margin: 1,
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('QR generation failed:', err);
      setPrintError('Failed to generate QR code');
      return;
    }

    setPrintData({ qr_id: qrId, name: binName, dataUrl });

    // Give the DOM a beat to render the hidden label, then use the native
    // print path on Android (WebViews don't support window.print) and the
    // standard browser print dialog everywhere else.
    setTimeout(async () => {
      try {
        if (Capacitor.getPlatform() === 'android') {
          await Print.print();
        } else {
          window.print();
        }
      } catch (err) {
        console.error('Print failed:', err);
        setPrintError(err?.message || 'Print failed');
      }
    }, 250);
  };

  const handlePrintRandom = async (data) => {
    const { codes, layout } = data;
    // Avoid the two print containers ever coexisting in print media.
    setPrintData(null);
    setRandomPrintData({ dataUrls: [], layout });
    setPrintError('');
    setShowPrintHelper(true);

    let dataUrls = [];
    try {
      dataUrls = await Promise.all(
        codes.map((code) =>
          QRCode.toDataURL(code, { width: 400, margin: 1, errorCorrectionLevel: 'M' })
        )
      );
    } catch (err) {
      console.error('QR generation failed:', err);
      setPrintError('Failed to generate QR codes');
      return;
    }
    setRandomPrintData({ dataUrls, layout });

    const waitForImages = () => {
      const images = Array.from(document.querySelectorAll('.print-random-qr img'));
      if (images.length === 0) return true;
      return images.every((img) => img.complete && img.naturalWidth > 0);
    };

    const startTime = Date.now();
    const timeout = 6000;

    const check = async () => {
      if (waitForImages() || Date.now() - startTime > timeout) {
        try {
          if (Capacitor.getPlatform() === 'android') {
            // Do NOT clear here: Android rasterizes the final page after the
            // print dialog closes, so the DOM must survive until 'printComplete'.
            await Print.print({ pageSize: layout.pageSize });
          } else {
            window.print();
            setRandomPrintData(null);
            setShowPrintHelper(false);
          }
        } catch (err) {
          console.error('Print failed:', err);
          setPrintError(err?.message || 'Print failed');
        }
        return;
      }
      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  };

  const renderModalStack = () => {
    if (stack.length === 0) return null;
    return stack.map((layer, i) => {
      const { type, params } = layer;
      const hideClose = ['restore-points', 'bin-details', 'item-details', 'add-item', 'create-bin'].includes(type);
      const isLast = i === stack.length - 1;

      let view;
      switch (type) {
        case 'scanner': view = <Scanner onNavigate={onNavigate} onBack={onBack} refreshNonce={refreshNonce} />; break;
        case 'create-bin': view = <CreateBin qrId={params.qrId} onNavigate={onNavigate} onBack={onBack} onPrintBin={handlePrintBin} refreshNonce={refreshNonce} />; break;
        case 'bin-details': view = <BinDetails binId={params.binId} onNavigate={onNavigate} onBack={onBack} onPrintBin={handlePrintBin} modalTypes={modalTypes} refreshNonce={refreshNonce} />; break;
        case 'multi-add': view = <MultiAddModal binId={params.binId} onNavigate={onNavigate} onBack={onBack} refreshNonce={refreshNonce} />; break;
        case 'item-details': view = <ItemDetails itemId={params.itemId} autoAnalyze={params.autoAnalyze} pendingCreate={params.pendingCreate} binId={params.binId} onNavigate={onNavigate} onBack={onBack} refreshNonce={refreshNonce} />; break;
        case 'edit-item': view = <ItemForm mode="edit" itemId={params.itemId} onBack={onBack} refreshNonce={refreshNonce} />; break;
        case 'add-item': view = <ItemForm mode="create" binId={params.binId} onNavigate={onNavigate} onBack={onBack} refreshNonce={refreshNonce} />; break;
        case 'settings': view = <Settings onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} refreshNonce={refreshNonce} />; break;
        case 'restore-points': view = <RestorePoints onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} refreshNonce={refreshNonce} />; break;
        case 'print-randomized': view = <PrintRandomized onNavigate={onNavigate} onBack={onBack} onPrintRandom={handlePrintRandom} />; break;
        default: return null;
      }

      return (
        <div key={i} className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 60 + i, pointerEvents: isLast ? 'auto' : 'none' }}>
          <ModalShell onClose={onBack} hideClose={hideClose}>
            {view}
          </ModalShell>
        </div>
      );
    });
  };

  return (
    <div ref={rootRef} className="min-h-screen bg-slate-950 pb-28 text-slate-100 flex flex-col justify-between" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Main Content Area — Search is always the base view */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-2">
        <Search onNavigate={onNavigate} onBack={onBack} modalTypes={modalTypes} />
      </main>

      {/* Glassy modal overlay for all non-search views */}
      {renderModalStack()}

      {/* Floating Bottom Navigation Bar (Hidden when printing label) */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-40 no-print">
        <nav className="glass-panel px-4 py-3 rounded-2xl shadow-2xl flex items-center justify-around gap-2 border border-slate-800/80">

          <button
            onClick={() => onNavigate('search')}
            className={`flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              stack[stack.length - 1]?.type === 'search'
                ? 'text-purple-400 bg-purple-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <SearchIcon className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Search</span>
          </button>

          {/* Scanner Tab */}
          <button
            onClick={() => onNavigate('scanner', {}, { replace: true })}
            className={`flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              stack[stack.length - 1]?.type === 'scanner'
                ? 'text-purple-400 bg-purple-500/10'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Scan</span>
          </button>

          {/* Add Tab */}
          <button
            onClick={() => onNavigate('quick-add', {}, { replace: true })}
            className="flex flex-col items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer text-slate-400 hover:text-slate-200"
          >
            <Plus className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">Add</span>
          </button>

        </nav>
      </div>

      {/* 4. ON-SCREEN PRINT HELPER MODAL OVERLAY (Visible on screen, excluded from printed page) */}
      {showPrintHelper && printData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm no-print">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-800 relative text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <BackButton
              onClick={() => {
                setShowPrintHelper(false);
                setPrintData(null);
                setPrintError('');
              }}
              className="absolute top-4 left-4"
              aria-label="Back to Search"
            />

            <div className="p-3 bg-purple-500/10 rounded-full text-purple-400 w-fit mx-auto">
              <Printer className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-slate-200">Printing Label</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                The native print dialog has been triggered. Please ensure paper size is set to <strong>8.5" x 11" (Letter)</strong> and orientation is <strong>Landscape</strong>.
              </p>
            </div>

            {printError && (
              <MessageBanner
                type="error"
                message={printError}
                className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-300"
                iconClassName="w-4 h-4 shrink-0 mt-0.5"
              />
            )}

            {/* Android Settings printer deep-link fallback */}
            {Capacitor.getPlatform() === 'android' && (
              <div className="bg-slate-900/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2 text-left">
                <div className="flex gap-2 text-[10px] text-slate-400 items-start">
                  <Info className="w-3.5 h-3.5 text-pink-400 shrink-0 mt-0.5" />
                  <span>
                    Having trouble finding your printer? Configure locally networked printer drivers (HP, Mopria, etc.) in System Settings.
                  </span>
                </div>
                <button
                  onClick={() => Print.openPrintSettings()}
                  className="w-full py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-200 font-bold text-[10px] flex items-center justify-center gap-1 transition-all cursor-pointer shadow-md"
                >
                  <SettingsIcon className="w-3.5 h-3.5" /> Configure Android Printers
                </button>
              </div>
            )}

            <button
              onClick={() => {
                setShowPrintHelper(false);
                setPrintData(null);
                setPrintError('');
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
            src={printData.dataUrl}
            alt="Print QR Label"
            className="print-qr-code"
          />
          <h1 className="print-bin-name">{printData.name}</h1>
        </div>
      )}

      {randomPrintData && randomPrintData.dataUrls.length > 0 && (
        <div className="print-random-qr hidden">
          {(() => {
            const { dataUrls, layout } = randomPrintData;
            const {
              pageWidth,
              pageHeight,
              cols,
              rows,
              labelWidth,
              labelHeight,
              marginTop,
              marginRight,
              marginBottom,
              marginLeft,
              gapX,
              gapY,
              perPage,
            } = layout;
            const qrSize = Math.max(0.5, Math.min(labelWidth, labelHeight));
            const pages = [];
            for (let i = 0; i < dataUrls.length; i += perPage) {
              pages.push(dataUrls.slice(i, i + perPage));
            }
            return pages.map((pageUrls, pi) => (
              <div
                key={pi}
                className="print-page"
                style={{ width: `${pageWidth}in`, height: `${pageHeight}in` }}
              >
                <div
                  className="print-page-inner"
                  style={{
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    gap: `${gapY}in ${gapX}in`,
                    padding: `${marginTop}in ${marginRight}in ${marginBottom}in ${marginLeft}in`,
                  }}
                >
                  {pageUrls.map((url, ci) => (
                    <img
                      key={ci}
                      className="print-random-qr-code"
                      src={url}
                      alt="QR"
                      style={{ width: `${qrSize}in`, height: `${qrSize}in` }}
                    />
                  ))}
                </div>
              </div>
            ));
          })()}
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
