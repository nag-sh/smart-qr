import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Key, Eye, EyeOff, Save, CheckCircle2, AlertTriangle, 
  ExternalLink, FileJson, Download, Upload, Server,
  RefreshCw, ArrowDownToLine, ArrowUpFromLine, History, ArrowRight, ArrowLeft, Cloud
} from 'lucide-react';
import { 
  getStorageMode, setStorageMode as persistStorageMode, 
  getLocalExportData, restoreLocalData,
  localRecordsForSync, localRecordsFromSync
} from '../services/storage';
import {
  slugify, planImagePath, getImageBlob, storeImage, isImageRef, EXT_FROM_TYPE
} from '../services/localImages';
import JSZip from 'jszip';

export default function Settings({ onNavigate, onBack, modalTypes }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Storage and database mode states
  const [storageMode, setStorageModeState] = useState(getStorageMode()); // 'server' | 'local'

  // Import operations state
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState('');
  const [importError, setImportError] = useState('');
  const [includeImages, setIncludeImages] = useState(true);

  const importFileInputRef = useRef(null);



  // Sync state
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState('');
  const [syncError, setSyncError] = useState('');
  const [deleteUnreferenced, setDeleteUnreferenced] = useState(false);
  const [pendingSyncDirection, setPendingSyncDirection] = useState(null); // 'pull' | 'push'

  // Cloud server configuration
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudStatus, setCloudStatus] = useState('disconnected');
  const [cloudInput, setCloudInput] = useState('https://smartqr.nag.sh/api');
  const [connecting, setConnecting] = useState(false);
  const [cloudToken, setCloudToken] = useState('');
  const [cloudTokenInput, setCloudTokenInput] = useState('');
  const [showCloudToken, setShowCloudToken] = useState(false);

  const clearSyncFeedback = () => {
    setSyncSuccess('');
    setSyncError('');
  };

  // Pull: cloud server → local browser
  const handleSyncPull = async () => {
    clearSyncFeedback();
    setSyncLoading(true);
    try {
      const response = await fetch('/api/sync/pull');
      const data = await response.json();
      if (!data.success) throw new Error(data.message);

      const converted = await localRecordsFromSync(data.bins, data.items);

      const localBins = getLocalExportData().bins;
      const localItems = getLocalExportData().items;

      // Merge: server records win on conflict (same id), append new ones
      const mergedBins = [
        ...converted.bins,
        ...localBins.filter(b => !converted.bins.some(sb => sb.id === b.id))
      ];
      const mergedItems = [
        ...converted.items,
        ...localItems.filter(i => !converted.items.some(si => si.id === i.id))
      ];

      const finalBins = deleteUnreferenced ? converted.bins : mergedBins;
      const finalItems = deleteUnreferenced ? converted.items : mergedItems;

      await restoreLocalData({ bins: finalBins, items: finalItems });
      setSyncSuccess(`Pulled ${data.bins.length} bins and ${data.items.length} items from server.`);
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Sync pull failed.');
    } finally {
      setSyncLoading(false);
    }
  };

  // Push: local browser → cloud server
  const handleSyncPush = async () => {
    clearSyncFeedback();
    setSyncLoading(true);
    try {
      const { bins, items } = getLocalExportData();
      const syncData = await localRecordsForSync(bins, items);
      const response = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bins: syncData.bins, items: syncData.items, deleteUnreferenced })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      setSyncSuccess(`Pushed ${bins.length} bins and ${items.length} items to server.`);
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Sync push failed.');
    } finally {
      setSyncLoading(false);
    }
  };

  // Gate sync actions behind the delete-unref warning modal when needed
  const requestSync = (direction) => {
    clearSyncFeedback();
    if (deleteUnreferenced) {
      setPendingSyncDirection(direction);
      onNavigate('settings-warning');
    } else {
      direction === 'pull' ? handleSyncPull() : handleSyncPush();
    }
  };

  const confirmSync = () => {
    onBack();
    pendingSyncDirection === 'pull' ? handleSyncPull() : handleSyncPush();
    setPendingSyncDirection(null);
  };

  const testCloudConnection = useCallback(async (url, token) => {
    setCloudStatus('connecting');
    setConnecting(true);
    try {
      const headers = {};
      if (token && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }
      const response = await fetch(`${url}/bins`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000)
      });
      setCloudStatus(response.ok ? 'connected' : 'disconnected');
    } catch (err) {
      console.error('Cloud connection test failed:', err);
      setCloudStatus('disconnected');
    } finally {
      setConnecting(false);
    }
  }, []);

  const handleCloudClick = () => {
    setCloudInput(cloudUrl || 'https://smartqr.nag.sh/api');
    setCloudTokenInput(cloudToken || '');
    onNavigate('settings-cloud');
  };

  const handleCloudConnect = async () => {
    const trimmed = cloudInput.trim();
    if (!trimmed) return;

    const token = cloudTokenInput.trim();
    persistStorageMode('server');
    setStorageModeState('server');
    localStorage.setItem('cloud_server_url', trimmed);
    if (token) {
      localStorage.setItem('cloud_api_token', token);
    } else {
      localStorage.removeItem('cloud_api_token');
    }
    setCloudUrl(trimmed);
    setCloudToken(token);
    onBack();
    await testCloudConnection(trimmed, token);
  };

  const handleCloudDisable = () => {
    localStorage.removeItem('cloud_server_url');
    localStorage.removeItem('cloud_api_token');
    setCloudUrl('');
    setCloudToken('');
    setCloudTokenInput('');
    setCloudStatus('disconnected');
    onBack();
  };

  const handleCloudCancel = () => {
    onBack();
  };

  useEffect(() => {
    const stored = localStorage.getItem('gemini_api_key');
    if (stored) {
      setApiKey(stored);
    }
  }, []);

  useEffect(() => {
    const storedCloudUrl = localStorage.getItem('cloud_server_url');
    if (storedCloudUrl) {
      setCloudUrl(storedCloudUrl);
      const storedCloudToken = localStorage.getItem('cloud_api_token') || '';
      setCloudToken(storedCloudToken);
      testCloudConnection(storedCloudUrl, storedCloudToken);
    }
  }, [testCloudConnection]);

  const handleSave = (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);

    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('API Key cannot be empty');
      return;
    }

    localStorage.setItem('gemini_api_key', trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to remove your API Key?')) {
      localStorage.removeItem('gemini_api_key');
      setApiKey('');
      setError('');
      setSaved(false);
    }
  };

  // Toggle storage modes
  const handleStorageModeChange = (mode) => {
    if (confirm(`Switch storage database to ${mode === 'local' ? 'Local Browser Memory (Offline)' : 'Central SQLite Server'}? The page will reload.`)) {
      persistStorageMode(mode);
      setStorageModeState(mode);
      window.location.reload();
    }
  };

  const handleLocalExport = async (e) => {
    e.preventDefault();
    try {
      const { bins, items } = getLocalExportData();
      const zip = new JSZip();
      const usedSet = new Set();
      const binMap = new Map(bins.map(b => [b.id, b]));

      const rewrittenBins = [];
      for (const bin of bins) {
        let image_url = bin.image_url;
        if (isImageRef(image_url)) {
          const blob = await getImageBlob(image_url);
          if (blob) {
            const locSlug = slugify(bin.location, 'unsorted-location');
            const binSlug = slugify(bin.name, bin.id);
            const ext = EXT_FROM_TYPE[blob.type] || 'bin';
            const base = `images/${locSlug}/${binSlug}/bin.${ext}`;
            const path = planImagePath(base, usedSet);
            zip.file(path, blob);
            image_url = path;
          }
        }
        rewrittenBins.push({ ...bin, image_url });
      }

      const rewrittenItems = [];
      for (const item of items) {
        let image_url = item.image_url;
        if (isImageRef(image_url)) {
          const blob = await getImageBlob(image_url);
          if (blob) {
            const bin = binMap.get(item.bin_id);
            const locSlug = slugify(bin?.location, 'unsorted-location');
            const binSlug = slugify(bin?.name, bin?.id ?? 'unknown-bin');
            const itemSlug = slugify(item.name, item.id);
            const ext = EXT_FROM_TYPE[blob.type] || 'bin';
            const base = `images/${locSlug}/${binSlug}/${itemSlug}.${ext}`;
            const path = planImagePath(base, usedSet);
            zip.file(path, blob);
            image_url = path;
          }
        }
        rewrittenItems.push({ ...item, image_url });
      }

      zip.file('inventory.json', JSON.stringify({
        exported_at: new Date().toISOString(),
        owner: 'dion',
        image_layout: 'images/<location>/<bin>/<item>.*',
        bins: rewrittenBins,
        items: rewrittenItems
      }, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart_inventory_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to generate local export file.');
    }
  };

  // Import file processing flow
  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    setImportError('');
    setImportSuccess('');

    try {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.zip')) {
        if (storageMode === 'local') {
          const arrayBuffer = await file.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);
          const inventoryFile = zip.file('inventory.json');
          if (!inventoryFile) {
            throw new Error('Invalid zip archive: missing inventory.json');
          }
          const parsed = JSON.parse(await inventoryFile.async('string'));
          if (!parsed.bins || !parsed.items) {
            throw new Error('Invalid inventory.json format');
          }

          const convertImageUrl = async (record) => {
            if (typeof record.image_url !== 'string' || !record.image_url.startsWith('images/')) {
              return record;
            }
            const imageEntry = zip.file(record.image_url);
            if (!imageEntry) return { ...record, image_url: null };
            const blob = await imageEntry.async('blob');
            const ref = await storeImage(blob);
            return { ...record, image_url: ref };
          };

          const bins = await Promise.all(parsed.bins.map(convertImageUrl));
          const items = await Promise.all(parsed.items.map(convertImageUrl));
          await restoreLocalData({ bins, items });
          setImportSuccess('Offline local backup restored successfully! Reloading...');
          setTimeout(() => window.location.reload(), 1500);
          return;
        }

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/import/zip', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        if (!data.success) {
          throw new Error(data.message || 'Zip archive restore failed.');
        }
        setImportSuccess('Backup archive restored successfully! Reloading...');
        setTimeout(() => window.location.reload(), 1500);

      } else if (fileName.endsWith('.db')) {
        if (storageMode === 'local') {
          throw new Error('SQLite binary databases (.db) are not supported in Offline Local Browser mode. Switch to Server mode to restore SQLite backups.');
        }

        // Upload DB payload to Server
        const formData = new FormData();
        formData.append('dbFile', file);

        const response = await fetch('/api/import/db', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        if (!data.success) {
          throw new Error(data.message || 'SQLite database restore failed.');
        }
        setImportSuccess('Central SQLite database restored successfully! Reloading...');
        setTimeout(() => window.location.reload(), 1500);

      } else if (fileName.endsWith('.json')) {
        if (storageMode === 'local') {
          const reader = new FileReader();
          reader.onload = async (event) => {
            try {
              const parsed = JSON.parse(event.target.result);
              await restoreLocalData(parsed);
              setImportSuccess('Offline local backup restored successfully! Reloading...');
              setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
              setImportError('Invalid JSON format. Check backup file contents.');
              setImporting(false);
            }
          };
          reader.readAsText(file);
        } else {
          // Upload JSON payload to Server
          const formData = new FormData();
          formData.append('jsonFile', file);

          const response = await fetch('/api/import/json', {
            method: 'POST',
            body: formData
          });
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.message || 'JSON backup restoration failed.');
          }
          setImportSuccess('Central database restored from JSON successfully! Reloading...');
          setTimeout(() => window.location.reload(), 1500);
        }
      } else {
        throw new Error('Unsupported backup format. Please select a .zip, .db, or .json file.');
      }
    } catch (err) {
      console.error(err);
      setImportError(err.message || 'Data restoration failed.');
    } finally {
      setImporting(false);
      e.target.value = ''; // Reset file input
    }
  };

  const triggerImportFilePicker = () => {
    if (importFileInputRef.current) {
      importFileInputRef.current.click();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto py-6 px-4 space-y-6">
      {/* 1. DATABASE & STORAGE MODE + CLOUD SYNC */}
      <section className="space-y-6">
        
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Storage & Sync</h1>
            <p className="text-xs text-slate-400">Select database mode, then sync data between cloud and device</p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 gap-3 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800/80">
            <button
              onClick={handleCloudClick}
              className={`py-3 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                !cloudUrl
                  ? 'opacity-50 text-slate-400'
                  : storageMode === 'server'
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cloudUrl && (
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  cloudStatus === 'connected'
                    ? 'bg-emerald-500'
                    : cloudStatus === 'connecting'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-red-500'
                }`} />
              )}
              Cloud
            </button>
            <button
              onClick={() => handleStorageModeChange('local')}
              className={`py-3 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                storageMode === 'local'
                  ? 'bg-purple-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Local Only
             </button>
          </div>

          <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
            {storageMode === 'server' ? (
              <span>
                <strong>Cloud Mode:</strong> Synchronizes inventory to your Smart QR Cloud server.
              </span>
            ) : (
              <span>
                <strong>Offline Local Mode:</strong> Operates entirely client-side. Saves files and item entries in your browser's persistent memory. Zero server connection required.
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-800/80"></div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <RefreshCw className="w-3 h-3" />
            Cloud Sync
          </div>
          <div className="flex-1 h-px bg-slate-800/80"></div>
        </div>

        {/* Sync direction buttons — labels adapt to active storage mode */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => requestSync('pull')}
            disabled={syncLoading}
            className="p-3.5 rounded-xl glass-card border border-slate-800/60 hover:border-purple-500/30 flex flex-col items-center gap-2 transition-all cursor-pointer group disabled:opacity-50"
          >
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400 group-hover:scale-110 transition-transform">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="block text-xs font-bold text-slate-200 group-hover:text-purple-300">Cloud → Local</span>
              <span className="block text-[9px] text-slate-500 mt-0.5">
                {storageMode === 'server' ? 'Merge server data into browser' : 'Pull server into local storage'}
              </span>
            </div>
          </button>

          <button
            onClick={() => requestSync('push')}
            disabled={syncLoading}
            className="p-3.5 rounded-xl glass-card border border-slate-800/60 hover:border-pink-500/30 flex flex-col items-center gap-2 transition-all cursor-pointer group disabled:opacity-50"
          >
            <div className="p-2 bg-pink-500/10 rounded-lg text-pink-400 group-hover:scale-110 transition-transform">
              <ArrowUpFromLine className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="block text-xs font-bold text-slate-200 group-hover:text-pink-300">Local → Cloud</span>
              <span className="block text-[9px] text-slate-500 mt-0.5">
                {storageMode === 'server' ? 'Upload browser data to server' : 'Push local storage to server'}
              </span>
            </div>
          </button>
        </div>

        {/* Delete unreferenced checkbox */}
        <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800/60 cursor-pointer select-none group">
          <div className="relative mt-0.5">
            <input
              type="checkbox"
              checked={deleteUnreferenced}
              onChange={(e) => setDeleteUnreferenced(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              deleteUnreferenced
                ? 'bg-red-500 border-red-500'
                : 'border-slate-600 bg-slate-800 group-hover:border-slate-400'
            }`}>
              {deleteUnreferenced && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-300">Delete unreferenced bins/items</span>
            <span className="block text-[10px] text-slate-500 mt-0.5 leading-normal">
              Records on the destination not present in the source will be permanently deleted.
            </span>
          </div>
        </label>

        {/* Sync feedback */}
        {syncLoading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-purple-300 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Syncing data...</span>
          </div>
        )}
        {syncSuccess && (
          <div className="mt-3 flex items-start gap-2 text-xs text-emerald-300 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{syncSuccess}</span>
          </div>
        )}
        {syncError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-300 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{syncError}</span>
          </div>
        )}
      </section>

      <hr className="border-slate-800/60" />

      {/* 2. API KEY + HELP */}
      <section className="space-y-6">

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">API Settings</h1>
            <p className="text-xs text-slate-400">Configure your Gemini API key for AI features</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4 mb-6">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-slate-300 mb-2">
              Gemini API Key
            </label>
            <div className="relative">
              <input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gemini Flash API Key"
                className="w-full px-4 py-3 pr-10 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 focus:outline-none cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Stored locally on your device's browser. Never shared with our servers.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {saved && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>API key updated successfully!</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 active:scale-98 transition-transform cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save Key
            </button>
            {apiKey && (
              <button
                type="button"
                onClick={handleClear}
                className="py-3 px-4 rounded-xl border border-slate-700/50 hover:bg-slate-800/40 text-slate-300 hover:text-red-400 font-medium text-sm transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-800/80"></div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <ExternalLink className="w-3 h-3" />
            How to get a key
          </div>
          <div className="flex-1 h-px bg-slate-800/80"></div>
        </div>

        <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside">
          <li>
            Go to{' '}
            <a
              href="https://aistudio.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 underline inline-flex items-center gap-0.5"
            >
              Google AI Studio <ExternalLink className="w-3 h-3" />
            </a>
          </li>
          <li>Sign in with your Google account.</li>
          <li>Click <strong className="text-slate-300">"Get API Key"</strong> in the top sidebar.</li>
          <li>Create a new key — free-tier accounts are available.</li>
          <li>Copy and paste it into the field above.</li>
        </ol>
      </section>

      <hr className="border-slate-800/60" />

      {/* 3. DATA BACKUP, EXPORT & IMPORT UTILITIES */}
      <section className="space-y-6">
          <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
            Data Operations
          </h2>
          <p className="text-[11px] text-slate-400 leading-normal">
            Download your inventory backups or upload files to restore catalog states.
          </p>

          {/* Export items */}
          <div className="space-y-2">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Export Backups</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {storageMode === 'server' ? (
                <a
                  href={`/api/export/zip?includeImages=${includeImages}`}
                  download
                  aria-label="Export backup as zip"
                  className="p-3 rounded-xl glass-card border border-slate-800/60 flex items-center justify-between hover:border-pink-500/30 transition-all text-left group cursor-pointer sm:col-span-2 w-full"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-pink-500/10 rounded-lg text-pink-400">
                      <FileJson className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-slate-200 group-hover:text-pink-300">Export Backup (.zip)</span>
                      <span className="block text-[9px] text-slate-500">JSON + images archive</span>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-200 transition-colors" />
                </a>
              ) : (
                <button
                  onClick={handleLocalExport}
                  className="p-3 rounded-xl glass-card border border-slate-800/60 flex items-center justify-between hover:border-pink-500/30 transition-all text-left group cursor-pointer w-full sm:col-span-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-pink-500/10 rounded-lg text-pink-400">
                      <FileJson className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-xs font-bold text-slate-200 group-hover:text-pink-300">ZIP Export</span>
                      <span className="block text-[9px] text-slate-500">Local browser export</span>
                    </div>
                  </div>
                  <Download className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-200 transition-colors" />
                </button>
              )}
            </div>

            {storageMode === 'server' && (
              <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800/60 cursor-pointer select-none group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={includeImages}
                    onChange={(e) => setIncludeImages(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    includeImages
                      ? 'bg-purple-500 border-purple-500'
                      : 'border-slate-600 bg-slate-800 group-hover:border-slate-400'
                  }`}>
                    {includeImages && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-300">Include images</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5 leading-normal">
                    When checked, the zip includes uploaded photos. Uncheck to export only the JSON data.
                  </span>
                </div>
              </label>
            )}
          </div>

          {/* Import Backup utilities */}
          <div className="space-y-3 pt-3 border-t border-slate-800/50">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Import Backups</span>
            
            <input 
              type="file" 
              accept=".db,.json,.zip" 
              ref={importFileInputRef}
              onChange={handleImportFile}
              className="hidden"
            />

            <button
              onClick={triggerImportFilePicker}
              disabled={importing}
              className="w-full p-4 rounded-xl border border-dashed border-slate-800 hover:border-purple-500/30 bg-slate-950/40 hover:bg-slate-950/65 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer group"
            >
              <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl group-hover:scale-105 transition-transform">
                <Upload className="w-5 h-5" />
              </div>
              <div className="text-center">
                <span className="block text-xs font-bold text-slate-200 group-hover:text-purple-300">
                  {importing ? 'Processing file...' : 'Import backup (.zip, .db, or .json)'}
                </span>
                <span className="block text-[9px] text-slate-500 mt-0.5">
                  Restores database and all images from the selected archive
                </span>
              </div>
            </button>

            {/* Operation Feedback */}
            {importError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            {importSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{importSuccess}</span>
              </div>
            )}
          </div>
      </section>

      <hr className="border-slate-800/60" />

      {/* 4. RESTORE POINTS */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Restore Points</h1>
            <p className="text-xs text-slate-400">Browse and recover database snapshots</p>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Every edit, import, and sync is automatically versioned into snapshots. Restore Points let you roll back the entire database or cherry-pick individual bins and items, combining granular changes into a single recovery action.
          </p>

          <button
            onClick={() => onNavigate('restore-points')}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 active:scale-98 transition-transform cursor-pointer"
          >
            <History className="w-4 h-4" />
            View Restore Points
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>


      {/* DELETE-UNREFERENCED DANGER MODAL */}
      {modalTypes?.includes('settings-warning') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-red-500/20 space-y-5 relative">
            <button
              onClick={() => { onBack(); setPendingSyncDirection(null); }}
              className="absolute top-4 left-4 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="text-center space-y-3">
              <div className="p-3 bg-red-500/15 rounded-full w-fit mx-auto">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-base font-bold text-red-300">Destructive Sync Warning</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-200">"Delete unreferenced bins/items"</strong> is enabled.
                Any records on the <em>destination</em> that are <em>not present in the source</em> will be{' '}
                <strong className="text-red-400">permanently deleted</strong>.
              </p>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 flex gap-2 text-[11px] text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>
                We strongly recommend <strong>exporting a backup</strong> from the Data Operations section before proceeding.
              </span>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={confirmSync}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 transition-all shadow-lg shadow-red-900/20"
              >
                I understand — proceed with sync
              </button>
              <button
                onClick={() => { onBack(); setPendingSyncDirection(null); }}
                className="w-full py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-semibold text-xs cursor-pointer transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLOUD SERVER CONFIGURATION MODAL */}
      {modalTypes?.includes('settings-cloud') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm pointer-events-auto"
          onClick={handleCloudCancel}
        >
          <div
            className="glass-panel w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-800/60 space-y-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCloudCancel}
              className="absolute top-4 left-4 p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="text-center space-y-3">
              <div className="p-3 bg-purple-500/15 rounded-full w-fit mx-auto">
                <Cloud className="w-8 h-8 text-purple-400" />
              </div>
              <h2 className="text-base font-bold text-purple-300">Cloud Server Configuration</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter the address of your Smart QR Cloud server.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="cloudUrl" className="block text-xs font-semibold text-slate-300">
                Server Address
              </label>
              <input
                id="cloudUrl"
                type="text"
                value={cloudInput}
                onChange={(e) => setCloudInput(e.target.value)}
                placeholder="https://smartqr.nag.sh/api"
                className="w-full px-4 py-3 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500 font-mono"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="cloudToken" className="block text-xs font-semibold text-slate-300">
                API Token <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <input
                  id="cloudToken"
                  type={showCloudToken ? 'text' : 'password'}
                  value={cloudTokenInput}
                  onChange={(e) => setCloudTokenInput(e.target.value)}
                  placeholder="Bearer token for cloud server"
                  className="w-full px-4 py-3 pr-10 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowCloudToken(!showCloudToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 focus:outline-none cursor-pointer"
                >
                  {showCloudToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-normal">
                Optional authentication token sent as a Bearer header during connection tests.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleCloudConnect}
                disabled={connecting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all disabled:opacity-50"
              >
                {connecting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Cloud className="w-4 h-4" />
                )}
                Connect
              </button>
              <button
                onClick={handleCloudCancel}
                className="w-full py-2.5 rounded-xl border border-slate-700/60 hover:bg-slate-800 text-slate-300 font-semibold text-xs cursor-pointer transition-all"
              >
                Cancel
              </button>
              {cloudUrl && (
                <button
                  onClick={handleCloudDisable}
                  className="w-full py-2.5 rounded-xl border border-red-700/50 hover:bg-red-950/40 text-red-300 font-semibold text-xs cursor-pointer transition-all"
                >
                  Disable Cloud
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
