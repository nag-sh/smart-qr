import React, { useState, useEffect } from 'react';
import {
  History, RotateCcw, Clock, Plus, RefreshCw, CheckCircle2, AlertTriangle,
  Box, Package, ArrowLeft, GitBranch, Check, Layers, Info, Pencil, Trash2
} from 'lucide-react';
import {
  getAuditLog, restoreAuditEntry, cherryPickAuditEntry, restoreSelectedChanges
} from '../services/storage';
import useImageSrc from '../hooks/useImageSrc';

function AffectedImage({ url, name }) {
  const src = useImageSrc(url);
  return src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : null;
}

export default function RestorePoints({ onNavigate, onBack, modalTypes, refreshNonce }) {
  // Audit timeline state
  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Revert / cherry-pick modal state
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [cherryPickMode, setCherryPickMode] = useState(false);
  const [cherryPickBins, setCherryPickBins] = useState([]);
  const [cherryPickItems, setCherryPickItems] = useState([]);
  const [selectedBinsToPick, setSelectedBinsToPick] = useState(new Set());
  const [selectedItemsToPick, setSelectedItemsToPick] = useState(new Set());

  // Multi-select restore state
  const [selectedChangesToRestore, setSelectedChangesToRestore] = useState(new Set());
  const [multiRestoreConflicts, setMultiRestoreConflicts] = useState([]);

  // Details modal state
  const [selectedAuditEntry, setSelectedAuditEntry] = useState(null);

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const data = await getAuditLog();
      setAuditLog(data.entries || []);
    } catch (e) {
      console.error(e);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [refreshNonce]);

  const getOperationColor = (op) => {
    if (op.startsWith('CREATE_')) return 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400';
    if (op.startsWith('EDIT_')) return 'bg-blue-500/10 border-blue-500/35 text-blue-400';
    if (op.startsWith('DELETE_')) return 'bg-red-500/10 border-red-500/35 text-red-400';
    if (op.startsWith('IMPORT_') || op.startsWith('SYNC_')) return 'bg-amber-500/10 border-amber-500/35 text-amber-400';
    if (op === 'RESTORE') return 'bg-purple-500/10 border-purple-500/35 text-purple-400';
    return 'bg-slate-500/10 border-slate-500/35 text-slate-400';
  };

  const getOperationIcon = (op) => {
    if (op.startsWith('CREATE_')) return <Plus className="w-3.5 h-3.5" />;
    if (op.startsWith('EDIT_')) return <Pencil className="w-3.5 h-3.5" />;
    if (op.startsWith('DELETE_')) return <Trash2 className="w-3.5 h-3.5" />;
    if (op.startsWith('IMPORT_') || op.startsWith('SYNC_')) return <RefreshCw className="w-3.5 h-3.5" />;
    if (op === 'RESTORE') return <RotateCcw className="w-3.5 h-3.5" />;
    return <Layers className="w-3.5 h-3.5" />;
  };

  const getRelativeTime = (isoString) => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
  };

  const groupAuditByTime = (entries) => {
    const now = Date.now();
    const today = [], thisWeek = [], older = [];
    for (const e of entries) {
      const age = now - new Date(e.created_at).getTime();
      if (age < 86400000) today.push(e);
      else if (age < 604800000) thisWeek.push(e);
      else older.push(e);
    }
    return { today, thisWeek, older };
  };

  const handleRestoreCheckpoint = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreSuccess('');
    setRestoreError('');
    try {
      await restoreAuditEntry(restoreTarget.id);
      setRestoreSuccess('Checkpoint restored successfully! Reloading...');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setRestoreError(err.message || 'Failed to restore checkpoint.');
      setRestoring(false);
    }
  };

  const handleStartCherryPick = (entry) => {
    setRestoreTarget(entry);
    try {
      const snapBins = JSON.parse(entry.bins_snapshot);
      const snapItems = JSON.parse(entry.items_snapshot);
      setCherryPickBins(snapBins);
      setCherryPickItems(snapItems);
      setSelectedBinsToPick(new Set(snapBins.map(b => b.id)));
      setSelectedItemsToPick(new Set(snapItems.map(i => i.id)));
      setCherryPickMode(true);
    } catch (err) {
      console.error(err);
      alert('Failed to parse snapshot records.');
    }
  };

  const handleCherryPickApply = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreSuccess('');
    setRestoreError('');
    try {
      await cherryPickAuditEntry(restoreTarget.id, Array.from(selectedBinsToPick), Array.from(selectedItemsToPick));
      setRestoreSuccess('Selected records cherry-picked successfully! Reloading...');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setRestoreError(err.message || 'Failed to cherry pick records.');
      setRestoring(false);
    }
  };

  const handleStartMultiRestore = () => {
    if (selectedChangesToRestore.size === 0) return;
    setMultiRestoreConflicts([]);
    setRestoreSuccess('');
    setRestoreError('');
    onNavigate('restore-multi');
  };

  const handleMultiRestoreApply = async () => {
    setRestoring(true);
    setRestoreSuccess('');
    setRestoreError('');
    setMultiRestoreConflicts([]);
    try {
      const ids = Array.from(selectedChangesToRestore);
      const res = await restoreSelectedChanges(ids);
      setRestoreSuccess(`Successfully restored ${res.binsCount} bin(s) and ${res.itemsCount} item(s)! Reloading...`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      if (err.conflicts) {
        setMultiRestoreConflicts(err.conflicts);
        setRestoreError('Restoration blocked due to conflicts.');
      } else {
        setRestoreError(err.message || 'Restoration failed.');
      }
      setRestoring(false);
    }
  };

  const toggleSelectChange = (id) => {
    const next = new Set(selectedChangesToRestore);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedChangesToRestore(next);
  };

  const getAffectedEntities = (entry, predecessor) => {
    try {
      const currBins = entry.bins_snapshot ? JSON.parse(entry.bins_snapshot) : [];
      const currItems = entry.items_snapshot ? JSON.parse(entry.items_snapshot) : [];
      const prevBins = (predecessor && predecessor.bins_snapshot) ? JSON.parse(predecessor.bins_snapshot) : [];
      const prevItems = (predecessor && predecessor.items_snapshot) ? JSON.parse(predecessor.items_snapshot) : [];

      const affected = [];
      const currBinsMap = new Map(currBins.map(b => [b.id, b]));
      const prevBinsMap = new Map(prevBins.map(b => [b.id, b]));
      const currItemsMap = new Map(currItems.map(i => [i.id, i]));
      const prevItemsMap = new Map(prevItems.map(i => [i.id, i]));

      currBins.forEach(b => {
        const prev = prevBinsMap.get(b.id);
        if (!prev) {
          affected.push({ type: 'bin', action: 'Created', name: b.name, location: b.location, image_url: b.image_url });
        } else if (JSON.stringify(prev) !== JSON.stringify(b)) {
          affected.push({ type: 'bin', action: 'Modified', name: b.name, location: b.location, image_url: b.image_url });
        }
      });
      prevBins.forEach(b => {
        if (!currBinsMap.has(b.id)) {
          affected.push({ type: 'bin', action: 'Deleted', name: b.name, location: b.location, image_url: b.image_url, isDeleted: true });
        }
      });

      currItems.forEach(i => {
        const prev = prevItemsMap.get(i.id);
        if (!prev) {
          affected.push({ type: 'item', action: 'Created', name: i.name, location: i.bin_location || '', image_url: i.image_url });
        } else if (JSON.stringify(prev) !== JSON.stringify(i)) {
          affected.push({ type: 'item', action: 'Modified', name: i.name, location: i.bin_location || '', image_url: i.image_url });
        }
      });
      prevItems.forEach(i => {
        if (!currItemsMap.has(i.id)) {
          affected.push({ type: 'item', action: 'Deleted', name: i.name, location: i.bin_location || '', image_url: i.image_url, isDeleted: true });
        }
      });

      return affected;
    } catch (e) {
      console.error('Error diffing snapshots:', e);
      return [];
    }
  };

  const sectionTitle = (key) => {
    if (key === 'today') return 'Today';
    if (key === 'thisWeek') return 'This Week';
    return 'Older';
  };

  const renderTimeline = () => {
    if (auditLoading) {
      return (
        <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
          <span>Loading restore points...</span>
        </div>
      );
    }

    if (auditLog.length === 0) {
      return (
        <div className="p-5 flex flex-col items-center gap-3 text-center border border-dashed border-slate-800 rounded-2xl">
          <Layers className="w-8 h-8 text-slate-600" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-slate-400">No checkpoints yet</p>
            <p className="text-[10px] text-slate-500 leading-normal">Edits, imports, and syncs create restore points.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {Object.entries(groupAuditByTime(auditLog)).map(([key, list]) => {
          if (list.length === 0) return null;
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <Clock className="w-3 h-3" />
                {sectionTitle(key)}
              </div>
              <div className="space-y-2">
                {list.map(entry => (
                  <div
                    key={entry.id}
                    onClick={() => { setSelectedAuditEntry(entry); onNavigate('restore-details'); }}
                    className={`p-2.5 bg-slate-900/40 border rounded-xl hover:bg-slate-900/65 hover:border-purple-500/30 transition-all cursor-pointer ${
                      selectedChangesToRestore.has(entry.id) ? 'border-purple-500 bg-purple-950/10' : 'border-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selectedChangesToRestore.has(entry.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectChange(entry.id)}
                        className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer h-4 w-4 shrink-0"
                        title="Select this change for selective restore"
                      />
                      <span className={`p-1.5 border rounded-lg shrink-0 ${getOperationColor(entry.operation)}`}>
                        {getOperationIcon(entry.operation)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-slate-200 truncate">{entry.description}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3 text-slate-600" />
                          <span className="text-[10px] text-slate-500 font-mono leading-none">{getRelativeTime(entry.created_at)}</span>
                          <span className={`text-[8px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider leading-none ${
                            entry.granularity === 'weekly'
                              ? 'bg-purple-500/10 text-purple-300'
                              : entry.granularity === 'daily'
                                ? 'bg-blue-500/10 text-blue-300'
                                : 'bg-slate-800 text-slate-400'
                          }`}>
                            {entry.granularity}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 ml-7">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartCherryPick(entry);
                          onNavigate('restore-cherry');
                        }}
                        className="flex-1 py-1.5 px-2 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-purple-600/10 hover:border-purple-500/20 text-[10px] font-bold text-slate-300 hover:text-purple-300 flex items-center justify-center gap-1 cursor-pointer transition-all"
                        title="Cherry-pick specific bins/items"
                      >
                        <GitBranch className="w-3 h-3 text-purple-400" />
                        Cherry-Pick
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRestoreTarget(entry);
                          setCherryPickMode(false);
                          onNavigate('restore-revert');
                        }}
                        className="flex-1 py-1.5 px-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-[10px] font-bold text-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95"
                        title="Overwrite entire database to this checkpoint"
                      >
                        <RotateCcw className="w-3 h-3 text-slate-400" />
                        Revert
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-4 px-3 space-y-4 relative overflow-hidden">
      {/* Header with back button */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => onBack()}
          className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
          aria-label="Back to Settings"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center gap-2.5">
          <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Restore Points</h1>
            <p className="text-[10px] text-slate-400">Rollback or cherry-pick checkpoints</p>
          </div>
        </div>
      </div>

      {/* Timeline panel */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl"></div>
      {renderTimeline()}


      {/* Floating multi-restore action */}
      {selectedChangesToRestore.size > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-sm">
          <button
            onClick={handleStartMultiRestore}
            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-900/40 active:scale-95 transition-all cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            Restore Selected ({selectedChangesToRestore.size})
          </button>
        </div>
      )}

      {/* Restore / Cherry-pick confirmation modal */}
      {(modalTypes?.includes('restore-revert') || modalTypes?.includes('restore-cherry')) && restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm pointer-events-auto">
          <div className={`glass-panel w-full ${cherryPickMode ? 'max-w-2xl' : 'max-w-sm'} rounded-3xl p-5 shadow-2xl border border-purple-500/20 space-y-4 relative max-h-[90vh] flex flex-col justify-between`}>
            <button
              onClick={() => { if (!restoring) { onBack(); } }}
              className="absolute top-3 left-3 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back"
              disabled={restoring}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {cherryPickMode ? (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                <div className="space-y-1 shrink-0 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <GitBranch className="w-5 h-5 text-purple-400" />
                    <h2 className="text-base font-bold text-slate-200">Cherry-Pick</h2>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Select bins/items to restore from this checkpoint.
                  </p>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden min-h-[220px]">
                  {/* Bins list */}
                  <div className="flex flex-col border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/30">
                    <div className="p-2.5 bg-slate-900/50 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Box className="w-3.5 h-3.5 text-purple-400" /> Bins ({cherryPickBins.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedBinsToPick.size === cherryPickBins.length) setSelectedBinsToPick(new Set());
                          else setSelectedBinsToPick(new Set(cherryPickBins.map(b => b.id)));
                        }}
                        className="text-[10px] font-semibold text-purple-400 hover:text-purple-300"
                      >
                        {selectedBinsToPick.size === cherryPickBins.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="flex-1 p-2 space-y-1 overflow-y-auto max-h-52">
                      {cherryPickBins.length === 0 ? (
                        <div className="text-[10px] text-slate-600 p-3 text-center">No bins in checkpoint.</div>
                      ) : (
                        cherryPickBins.map(bin => (
                          <label key={bin.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-900/50 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedBinsToPick.has(bin.id)}
                              onChange={() => {
                                const next = new Set(selectedBinsToPick);
                                if (next.has(bin.id)) next.delete(bin.id);
                                else next.add(bin.id);
                                setSelectedBinsToPick(next);
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-xs text-slate-300 truncate">{bin.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="flex flex-col border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/30">
                    <div className="p-2.5 bg-slate-900/50 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-pink-400" /> Items ({cherryPickItems.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedItemsToPick.size === cherryPickItems.length) setSelectedItemsToPick(new Set());
                          else setSelectedItemsToPick(new Set(cherryPickItems.map(i => i.id)));
                        }}
                        className="text-[10px] font-semibold text-purple-400 hover:text-purple-300"
                      >
                        {selectedItemsToPick.size === cherryPickItems.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="flex-1 p-2 space-y-1 overflow-y-auto max-h-52">
                      {cherryPickItems.length === 0 ? (
                        <div className="text-[10px] text-slate-600 p-3 text-center">No items in checkpoint.</div>
                      ) : (
                        cherryPickItems.map(item => (
                          <label key={item.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-900/50 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={selectedItemsToPick.has(item.id)}
                              onChange={() => {
                                const next = new Set(selectedItemsToPick);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                setSelectedItemsToPick(next);
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-xs text-slate-300 truncate">{item.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-3 shrink-0">
                <div className="p-3 bg-purple-500/15 rounded-full w-fit mx-auto">
                  <RotateCcw className="w-8 h-8 text-purple-400" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-200">Restore Checkpoint</h2>
                  <p className="text-xs text-slate-300 truncate px-2">"{restoreTarget.description}"</p>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
                    <Clock className="w-3 h-3" />
                    {getRelativeTime(restoreTarget.created_at)}
                  </div>
                </div>
                <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 flex items-center gap-2 text-[11px] text-red-300 text-left">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>Overwrites all changes since this point.</span>
                </div>
              </div>
            )}

            <div className="space-y-3 shrink-0 pt-2 border-t border-slate-800">
              {restoreSuccess && (
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {restoreSuccess}
                </div>
              )}
              {restoreError && (
                <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-300 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {restoreError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { onBack(); }}
                  disabled={restoring}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer transition-all"
                >
                  Cancel
                </button>
                {cherryPickMode ? (
                  <button
                    onClick={handleCherryPickApply}
                    disabled={restoring || (selectedBinsToPick.size === 0 && selectedItemsToPick.size === 0)}
                    className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                  >
                    {restoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Apply ({selectedBinsToPick.size + selectedItemsToPick.size})
                  </button>
                ) : (
                  <button
                    onClick={handleRestoreCheckpoint}
                    disabled={restoring}
                    className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-lg shadow-purple-900/20"
                  >
                    {restoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Revert All
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-change cherry-pick restore modal */}
      {modalTypes?.includes('restore-multi') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-purple-500/20 space-y-4 relative max-h-[90vh] flex flex-col justify-between">
            <button
              onClick={() => { if (!restoring) onBack(); }}
              className="absolute top-3 left-3 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back"
              disabled={restoring}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="text-center space-y-3 shrink-0">
              <div className="p-3 bg-purple-500/15 rounded-full w-fit mx-auto">
                <RotateCcw className="w-8 h-8 text-purple-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-200">Restore {selectedChangesToRestore.size} Selected</h2>
                <p className="text-[10px] text-slate-400 leading-normal">Intermediate changes are preserved.</p>
              </div>
            </div>

            {multiRestoreConflicts.length > 0 ? (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                <span className="text-xs font-bold flex items-center gap-1 text-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Conflicts blocked restoration:
                </span>
                <ul className="list-disc list-inside space-y-1 text-[10px] text-red-300 leading-relaxed">
                  {multiRestoreConflicts.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3 flex items-center gap-2 text-xs text-emerald-300 shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No conflicts detected.</span>
              </div>
            )}

            <div className="space-y-3 shrink-0 pt-2 border-t border-slate-800">
              {restoreSuccess && (
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {restoreSuccess}
                </div>
              )}
              {restoreError && !multiRestoreConflicts.length && (
                <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-300 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {restoreError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onBack()}
                  disabled={restoring}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMultiRestoreApply}
                  disabled={restoring || multiRestoreConflicts.length > 0}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                >
                  {restoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audit entry details modal */}
      {modalTypes?.includes('restore-details') && selectedAuditEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in pointer-events-auto">
          <div className="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-purple-500/20 flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-4 border-b border-slate-800/60 bg-gradient-to-b from-purple-950/20 to-transparent flex items-center gap-3">
              <button
                onClick={() => onBack()}
                className="p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer shrink-0"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider flex items-center gap-0.5 ${getOperationColor(selectedAuditEntry.operation)}`}>
                    {getOperationIcon(selectedAuditEntry.operation)}
                    {selectedAuditEntry.operation}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {selectedAuditEntry.granularity}
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-100 truncate">{selectedAuditEntry.description}</h2>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5 font-mono">
                  <Clock className="w-3 h-3" />
                  {new Date(selectedAuditEntry.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="p-4 overflow-y-auto space-y-5 flex-1">
              {/* Affected entities diff pane */}
              <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3 h-3" />
                  Affected
                </h3>
                {(() => {
                  const currentLogIndex = auditLog.findIndex(e => e.id === selectedAuditEntry.id);
                  const predecessor = currentLogIndex + 1 < auditLog.length ? auditLog[currentLogIndex + 1] : null;
                  const affected = getAffectedEntities(selectedAuditEntry, predecessor);

                  if (affected.length === 0) {
                    return (
                      <div className="p-3 flex items-center gap-2 bg-slate-950/40 rounded-xl border border-slate-800 text-[10px] text-slate-500">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        No schema mutations detected.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {affected.map((ent, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-950/40 border border-slate-800 rounded-xl flex items-center gap-2.5"
                        >
                          <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                            {ent.image_url ? (
                              <AffectedImage url={ent.image_url} name={ent.name} />
                            ) : ent.type === 'bin' ? (
                              <Box className="w-4 h-4 text-slate-700 stroke-1" />
                            ) : (
                              <Package className="w-4 h-4 text-slate-700 stroke-1" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-slate-200 truncate">{ent.name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase leading-none ${
                                ent.action === 'Created'
                                  ? 'bg-green-500/10 text-green-400'
                                  : ent.action === 'Modified'
                                    ? 'bg-blue-500/10 text-blue-400'
                                    : 'bg-red-500/10 text-red-400'
                              }`}>
                                {ent.action}
                              </span>
                              <span className="text-[9px] text-slate-500 font-medium capitalize">{ent.type}</span>
                              {ent.location && (
                                <span className="text-[9px] text-slate-500 truncate max-w-[80px]">
                                  @ {ent.location}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Surrounding entries (10-minute window) */}
              <div className="space-y-2 border-t border-slate-800/40 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    Nearby Activity
                  </h3>
                  {(() => {
                    const currentLogTime = new Date(selectedAuditEntry.created_at).getTime();
                    const surrounding = auditLog.filter(other => {
                      if (other.id === selectedAuditEntry.id) return false;
                      const otherTime = new Date(other.created_at).getTime();
                      return Math.abs(otherTime - currentLogTime) <= 10 * 60 * 1000;
                    });
                    return (
                      <span className="text-[10px] text-slate-500 font-medium">
                        {surrounding.length} changes
                      </span>
                    );
                  })()}
                </div>

                {(() => {
                  const currentLogTime = new Date(selectedAuditEntry.created_at).getTime();
                  const surrounding = auditLog.filter(other => {
                    if (other.id === selectedAuditEntry.id) return false;
                    const otherTime = new Date(other.created_at).getTime();
                    return Math.abs(otherTime - currentLogTime) <= 10 * 60 * 1000;
                  });

                  if (surrounding.length === 0) {
                    return (
                      <div className="p-3 flex items-center gap-2 bg-slate-950/20 border border-slate-800/60 rounded-xl text-[10px] text-slate-500">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        No other activity within 10 minutes.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {surrounding.map(other => (
                        <div
                          key={other.id}
                          onClick={() => setSelectedAuditEntry(other)}
                          className="p-2 bg-slate-900/30 border border-slate-800 hover:border-slate-700 rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`p-1 border rounded-md shrink-0 ${getOperationColor(other.operation)}`}>
                              {getOperationIcon(other.operation)}
                            </span>
                            <span className="text-xs text-slate-300 truncate font-semibold">{other.description}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                            {getRelativeTime(other.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer actions */}
            <div className="p-4 bg-slate-950/40 border-t border-slate-800/60 flex items-center justify-between gap-2 shrink-0">
              <button
                onClick={() => {
                  toggleSelectChange(selectedAuditEntry.id);
                  onBack();
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  selectedChangesToRestore.has(selectedAuditEntry.id)
                    ? 'bg-purple-600/20 border-purple-500/40 text-purple-300'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {selectedChangesToRestore.has(selectedAuditEntry.id) ? 'Deselect' : 'Select'}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleStartCherryPick(selectedAuditEntry);
                    setSelectedAuditEntry(null);
                    onNavigate('restore-cherry');
                  }}
                  className="py-2 px-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 font-bold text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <GitBranch className="w-3.5 h-3.5" /> Pick
                </button>
                <button
                  onClick={() => {
                    setRestoreTarget(selectedAuditEntry);
                    setCherryPickMode(false);
                    setSelectedAuditEntry(null);
                    onNavigate('restore-revert');
                  }}
                  className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-400" /> Revert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
