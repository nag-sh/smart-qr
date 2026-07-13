/**
 * Client Storage and Sync Service
 * Abstracts database interactions to support either:
 * 1. Server mode (SQLite backend API on port 5005)
 * 2. Local-only mode (PWA client-side IndexedDB/offline)
 */

import { Capacitor } from '@capacitor/core';
import piexif from 'piexifjs';
import {
  storeImage,
  deleteImage,
  refToDataURL,
  dataURLToBlob,
  blobToDataURL,
  isImageRef
} from './localImages';
import { getSetting, setSetting, removeSetting } from './appStore.js';
import { getTable, setTable, migrateFromLocalStorage } from './dbStore.js';

// Synchronous cached mode used by getStorageMode()/isLocalOnly().
// initStorage() must run at app bootstrap to populate this value.
let _cachedMode = 'local';

// Helper to get local storage tables
const getLocalTable = async (key) => {
  try {
    const data = await getTable(key);
    return data ?? [];
  } catch (err) {
    console.error(`Error reading local table ${key}:`, err);
    return [];
  }
};

const setLocalTable = async (key, data) => {
  try {
    await setTable(key, data);
  } catch (err) {
    console.error(`Error writing local table ${key}:`, err);
    throw new Error('Local browser storage quota exceeded. Try deleting some item photos.');
  }
};

export const getStorageMode = () => {
  return _cachedMode; // 'server' | 'local'
};

export const setStorageMode = async (mode) => {
  await setSetting('storage_mode', mode);
  _cachedMode = mode;
};

export const isLocalOnly = () => {
  return getStorageMode() === 'local';
};

export async function initStorage() {
  const persisted = await getSetting('storage_mode');
  _cachedMode = persisted || 'local';

  if (Capacitor.isNativePlatform()) {
    _cachedMode = 'local';
    await setSetting('storage_mode', 'local');
    await removeSetting('cloud_server_url');
    await removeSetting('cloud_api_token');
  }

  await migrateFromLocalStorage();

  console.log('[initStorage] mode=', _cachedMode, 'native=', Capacitor.isNativePlatform());
}

/**
 * Convert an image data URL to a JPEG data URL via an offscreen canvas.
 * Returns null if the source cannot be decoded. This lets non-JPEG uploads
 * (PNG/WebP) be re-encoded to JPEG so they can carry EXIF metadata.
 */
function toJpegDataURL(srcDataUrl) {
  return new Promise((resolve) => {
    if (!srcDataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = srcDataUrl;
  });
}

/**
 * Embed inventory metadata into an image's EXIF ImageDescription tag.
 * Forces JPEG output (piexifjs is JPEG-only) so PNG/WebP uploads also get
 * metadata. Returns the original input if embedding is not possible.
 */
async function embedLocalImageMetadata(input, metadata) {
  try {
    const wasBlob = input instanceof Blob;
    let dataURL = wasBlob ? await blobToDataURL(input) : input;
    if (!dataURL) return input;
    if (!dataURL.startsWith('data:image/jpeg')) {
      dataURL = await toJpegDataURL(dataURL);
    }
    if (!dataURL) return input;
    const exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {} };
    exifObj['0th'][piexif.ImageIFD.ImageDescription] = JSON.stringify(metadata);
    const exifBytes = piexif.dump(exifObj);
    const inserted = piexif.insert(exifBytes, dataURL);
    return wasBlob ? dataURLToBlob(inserted) : inserted;
  } catch (err) {
    console.error('embedLocalImageMetadata failed:', err);
    return input;
  }
}

/**
 * Append an entry to the local audit log. Never throws.
 */
async function saveLocalAuditEntry(operation, description) {
  try {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');
    const log = await getLocalTable('local_audit_log');
    log.push({
      id: crypto.randomUUID(),
      operation,
      description,
      bins_snapshot: JSON.stringify(bins),
      items_snapshot: JSON.stringify(items),
      created_at: new Date().toISOString(),
      granularity: 'individual'
    });
    await setLocalTable('local_audit_log', log);
  } catch (err) {
    console.error('saveLocalAuditEntry failed silently:', err);
  }
}

/**
 * Consolidate the local audit log:
 * - 24h–7d entries: keep only last per calendar day → granularity='daily'
 * - >7d entries: keep only last per ISO week → granularity='weekly'
 */
async function consolidateLocalAuditLog() {
  try {
    const log = await getLocalTable('local_audit_log');
    const now = Date.now();
    const DAY = 86400000;
    const WEEK = 604800000;

    const fresh = [];       // < 24h — keep all
    const byDay = {};       // 24h–7d keyed by YYYY-MM-DD
    const byWeek = {};      // >7d keyed by YYYY-Www

    for (const entry of log) {
      const age = now - new Date(entry.created_at).getTime();
      if (age < DAY) {
        fresh.push(entry);
      } else if (age < WEEK) {
        const day = entry.created_at.slice(0, 10);
        if (!byDay[day] || new Date(entry.created_at) > new Date(byDay[day].created_at)) {
          byDay[day] = { ...entry, granularity: 'daily' };
        }
      } else {
        // ISO week: use a simple key based on the year and week number
        const d = new Date(entry.created_at);
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil(((d - jan1) / DAY + jan1.getDay() + 1) / 7);
        const key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
        if (!byWeek[key] || new Date(entry.created_at) > new Date(byWeek[key].created_at)) {
          byWeek[key] = { ...entry, granularity: 'weekly' };
        }
      }
    }

    const consolidated = [
      ...fresh,
      ...Object.values(byDay),
      ...Object.values(byWeek)
    ];
    await setLocalTable('local_audit_log', consolidated);
  } catch (err) {
    console.error('consolidateLocalAuditLog failed:', err);
  }
}

/**
 * Remove quarantine entries older than 72 hours.
 */
async function cleanupLocalQuarantine() {
  try {
    const quarantine = await getLocalTable('local_quarantine');
    const cutoff = Date.now() - 72 * 3600000;
    const filtered = quarantine.filter(entry => {
      const t = new Date(entry.quarantined_at).getTime();
      return t >= cutoff;
    });
    await setLocalTable('local_quarantine', filtered);
  } catch (err) {
    console.error('cleanupLocalQuarantine failed:', err);
  }
}

/**
 * 1. GET ALL BINS
 */
export async function getBins() {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');
    
    // Join items to count them for each bin
    return bins.map(bin => {
      const binItems = items.filter(item => item.bin_id === bin.id);
      return {
        ...bin,
        item_count: binItems.length
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const response = await fetch('/api/bins');
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.bins;
}

/**
 * 2. GET BIN BY QR ID OR DATABASE ID
 */
export async function getBin(idOrQr) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');

    // Match by qr_id first, then database UUID id
    let bin = bins.find(b => b.qr_id === idOrQr);
    if (!bin) {
      bin = bins.find(b => b.id === idOrQr);
    }

    if (!bin) {
      throw new Error('Bin not found');
    }

    const binItems = items
      .filter(item => item.bin_id === bin.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return { bin, items: binItems };
  }

  const response = await fetch(`/api/bins/${encodeURIComponent(idOrQr)}`);
  if (response.status === 404) {
    throw new Error('Bin not found');
  }
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return { bin: data.bin, items: data.items };
}

/**
 * 3. CREATE BIN
 */
export async function createBin(qrId, name, location, imageFile) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    
    // Check duplication
    if (bins.some(b => b.qr_id === qrId)) {
      throw new Error('Bin with this QR ID already exists');
    }

    const id = crypto.randomUUID();
    let image_url = null;

    // Embed metadata into JPEG if possible
    if (imageFile) {
      const processed = await embedLocalImageMetadata(imageFile, {
        app: 'smart-inventory',
        owner: 'dion',
        entity_type: 'bin',
        entity_id: id,
        entity_name: name.trim(),
        qr_id: qrId,
        location: location.trim(),
        created_at: new Date().toISOString()
      });
      image_url = await storeImage(processed);
    }

    const newBin = {
      id,
      qr_id: qrId,
      name: name.trim(),
      location: location.trim(),
      image_url,
      created_at: new Date().toISOString()
    };

    bins.push(newBin);
    await setLocalTable('local_bins', bins);
    await saveLocalAuditEntry('CREATE_BIN', `Created bin: ${name.trim()}`);
    return newBin;
  }

  const formData = new FormData();
  formData.append('qr_id', qrId);
  formData.append('name', name.trim());
  formData.append('location', location.trim());
  if (imageFile) {
    formData.append('image', imageFile, 'bin.jpg');
  }

  const response = await fetch('/api/bins', {
    method: 'POST',
    body: formData
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.bin;
}

/**
 * 4. CREATE ITEM
 */
export async function createItem(binId, name, description, searchTagsArray, visibleText, imageFile) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');

    // Confirm parent bin exists
    const parentBin = bins.find(b => b.id === binId);
    if (!parentBin) {
      throw new Error('Parent bin not found');
    }

    const id = crypto.randomUUID();
    let image_url = null;

    // Embed metadata into JPEG if possible
    if (imageFile) {
      const processed = await embedLocalImageMetadata(imageFile, {
        app: 'smart-inventory',
        owner: 'dion',
        entity_type: 'item',
        entity_id: id,
        entity_name: name.trim(),
        bin_id: binId,
        bin_name: parentBin.name,
        location: parentBin.location,
        qr_id: parentBin.qr_id,
        created_at: new Date().toISOString()
      });
      image_url = await storeImage(processed);
    }

    const newItem = {
      id,
      bin_id: binId,
      name: name.trim(),
      description: description.trim(),
      image_url,
      search_tags: searchTagsArray || [],
      visible_text: visibleText.trim(),
      created_at: new Date().toISOString()
    };

    items.push(newItem);
    await setLocalTable('local_items', items);
    await saveLocalAuditEntry('CREATE_ITEM', `Created item: ${name.trim()} in bin: ${parentBin.name}`);
    return newItem;
  }

  const formData = new FormData();
  formData.append('bin_id', binId);
  formData.append('name', name.trim());
  formData.append('description', description.trim());
  formData.append('search_tags', JSON.stringify(searchTagsArray));
  formData.append('visible_text', visibleText.trim());
  if (imageFile) {
    formData.append('image', imageFile, 'item.jpg');
  }

  const response = await fetch('/api/items', {
    method: 'POST',
    body: formData
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.item;
}

/**
 * 5. SEARCH ITEMS / DISPLAY RECENT
 */
export async function searchItems(query) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');

    // Join parent bin details
    const joinedItems = items.map(item => {
      const parentBin = bins.find(b => b.id === item.bin_id);
      return {
        ...item,
        bin_name: parentBin ? parentBin.name : 'Unknown Bin',
        bin_location: parentBin ? parentBin.location : 'Unknown Location'
      };
    });

    if (!query || !query.trim()) {
      return joinedItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // Split query terms for prefix matching
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return joinedItems.filter(item => {
      // Build a unified searchable string representing item metadata
      const searchableText = `
        ${item.name} 
        ${item.description} 
        ${(item.search_tags || []).join(' ')} 
        ${item.visible_text || ''} 
        ${item.bin_name} 
        ${item.bin_location}
      `.toLowerCase();

      // Ensure every query term matches a substring
      return terms.every(term => searchableText.includes(term));
    });
  }

  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.items;
}

/**
 * Helper to load local database contents for JSON export
 */
export async function getLocalExportData() {
  const bins = await getLocalTable('local_bins');
  const items = await getLocalTable('local_items');
  return {
    exported_at: new Date().toISOString(),
    owner: 'dion',
    bins,
    items
  };
}

/**
 * Convert local image refs to base64 data URLs for server sync push.
 */
export async function localRecordsForSync(bins, items) {
  const convertRecord = async (record) => {
    if (!record || !isImageRef(record.image_url)) return record;
    const dataUrl = await refToDataURL(record.image_url);
    return { ...record, image_url: dataUrl };
  };
  return {
    bins: await Promise.all(bins.map(convertRecord)),
    items: await Promise.all(items.map(convertRecord))
  };
}

/**
 * Convert base64 data URLs from a server sync pull into local IndexedDB refs.
 */
export async function localRecordsFromSync(bins, items) {
  const convertRecord = async (record) => {
    if (!record || typeof record.image_url !== 'string' || !record.image_url.startsWith('data:')) {
      return record;
    }
    const blob = dataURLToBlob(record.image_url);
    const ref = await storeImage(blob);
    return { ...record, image_url: ref };
  };
  return {
    bins: await Promise.all(bins.map(convertRecord)),
    items: await Promise.all(items.map(convertRecord))
  };
}

/**
 * Helper to restore local database tables from JSON import file.
 * Any legacy base64 image_url values are moved into IndexedDB as refs.
 */
export async function restoreLocalData(data) {
  if (!data || !data.bins || !data.items) {
    throw new Error('Invalid JSON backup format');
  }
  const convertRecord = async (record) => {
    if (!record || typeof record.image_url !== 'string' || !record.image_url.startsWith('data:')) {
      return record;
    }
    const blob = dataURLToBlob(record.image_url);
    const ref = await storeImage(blob);
    return { ...record, image_url: ref };
  };
  const bins = await Promise.all(data.bins.map(convertRecord));
  const items = await Promise.all(data.items.map(convertRecord));
  await setLocalTable('local_bins', bins);
  await setLocalTable('local_items', items);
}

/**
 * 6. UPDATE BIN
 */
export async function updateBin(id, fields, imageFile = null) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const idx = bins.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('Bin not found');

    let image_url = bins[idx].image_url;

    if (imageFile) {
      if (isImageRef(image_url)) {
        await deleteImage(image_url);
      }
      // Convert new image and embed metadata
      const processed = await embedLocalImageMetadata(imageFile, {
        app: 'smart-inventory',
        owner: 'dion',
        entity_type: 'bin',
        entity_id: id,
        entity_name: (fields.name || bins[idx].name).trim(),
        qr_id: bins[idx].qr_id,
        location: bins[idx].location,
        created_at: bins[idx].created_at
      });
      image_url = await storeImage(processed);
    }

    bins[idx] = {
      ...bins[idx],
      name: (fields.name !== undefined ? fields.name : bins[idx].name).trim(),
      location: (fields.location !== undefined ? fields.location : bins[idx].location).trim(),
      image_url
    };

    await setLocalTable('local_bins', bins);
    await saveLocalAuditEntry('EDIT_BIN', `Edited bin: ${bins[idx].name}`);
    return bins[idx];
  }

  const formData = new FormData();
  if (fields.name !== undefined) formData.append('name', fields.name.trim());
  if (fields.location !== undefined) formData.append('location', fields.location.trim());
  if (imageFile) formData.append('image', imageFile, 'bin.jpg');

  const response = await fetch(`/api/bins/${id}`, {
    method: 'PUT',
    body: formData
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.bin;
}

/**
 * 7. DELETE BIN
 */
export async function deleteBin(id) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');

    const binItems = items.filter(i => i.bin_id === id);
    if (binItems.length > 0) {
      const err = new Error(`Cannot delete bin: it contains ${binItems.length} item(s). Manage them first.`);
      err.item_count = binItems.length;
      err.blocked = true;
      throw err;
    }

    const bin = bins.find(b => b.id === id);
    if (bin) {
      if (isImageRef(bin.image_url)) {
        await deleteImage(bin.image_url);
      }
      await saveLocalAuditEntry('DELETE_BIN', `Deleted bin: ${bin.name}`);
    }

    await setLocalTable('local_bins', bins.filter(b => b.id !== id));
    return { success: true };
  }

  const response = await fetch(`/api/bins/${id}`, { method: 'DELETE' });
  const data = await response.json();
  if (data.blocked) {
    const err = new Error(`Cannot delete bin: it contains ${data.item_count} item(s). Manage them first.`);
    err.item_count = data.item_count;
    err.blocked = true;
    throw err;
  }
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 8. BATCH MANAGE ITEMS
 */
export async function batchManageItems(binId, action, itemIds, targetBinId = null) {
  if (isLocalOnly()) {
    const items = await getLocalTable('local_items');

    if (action === 'reassign') {
      const updated = items.map(item => {
        if (itemIds.includes(item.id)) {
          return { ...item, bin_id: targetBinId };
        }
        return item;
      });
      await setLocalTable('local_items', updated);
    } else if (action === 'delete') {
      const toDelete = items.filter(i => itemIds.includes(i.id));
      for (const i of toDelete) {
        if (isImageRef(i.image_url)) {
          await deleteImage(i.image_url);
        }
      }
      await setLocalTable('local_items', items.filter(i => !itemIds.includes(i.id)));
    }

    await saveLocalAuditEntry('BATCH_ITEMS', `Batch ${action} of ${itemIds.length} item(s) from bin ${binId}`);
    return { success: true };
  }

  const response = await fetch(`/api/bins/${binId}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, itemIds, targetBinId })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 9. UPDATE ITEM
 */
export async function updateItem(id, fields, imageFile = null) {
  if (isLocalOnly()) {
    const items = await getLocalTable('local_items');
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new Error('Item not found');

    let image_url = items[idx].image_url;

    const localBins = await getLocalTable('local_bins');
    const parentBin = localBins.find(b => b.id === items[idx].bin_id);

    if (imageFile) {
      if (isImageRef(image_url)) {
        await deleteImage(image_url);
      }
      // Convert new image and embed metadata
      const processed = await embedLocalImageMetadata(imageFile, {
        app: 'smart-inventory',
        owner: 'dion',
        entity_type: 'item',
        entity_id: id,
        entity_name: (fields.name || items[idx].name).trim(),
        bin_id: items[idx].bin_id,
        bin_name: parentBin ? parentBin.name : '',
        location: parentBin ? parentBin.location : '',
        qr_id: parentBin ? parentBin.qr_id : '',
        created_at: items[idx].created_at
      });
      image_url = await storeImage(processed);
    }

    items[idx] = {
      ...items[idx],
      name: (fields.name !== undefined ? fields.name : items[idx].name).trim(),
      description: (fields.description !== undefined ? fields.description : items[idx].description).trim(),
      search_tags: fields.search_tags !== undefined ? fields.search_tags : items[idx].search_tags,
      visible_text: (fields.visible_text !== undefined ? fields.visible_text : items[idx].visible_text).trim(),
      image_url
    };

    await setLocalTable('local_items', items);
    await saveLocalAuditEntry('EDIT_ITEM', `Edited item: ${items[idx].name}`);
    return items[idx];
  }

  const formData = new FormData();
  if (fields.name !== undefined) formData.append('name', fields.name.trim());
  if (fields.description !== undefined) formData.append('description', fields.description.trim());
  if (fields.search_tags !== undefined) formData.append('search_tags', JSON.stringify(fields.search_tags));
  if (fields.visible_text !== undefined) formData.append('visible_text', fields.visible_text.trim());
  if (imageFile) formData.append('image', imageFile, 'item.jpg');

  const response = await fetch(`/api/items/${id}`, {
    method: 'PUT',
    body: formData
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data.item;
}

/**
 * 10. DELETE ITEM
 */
export async function deleteItem(id) {
  if (isLocalOnly()) {
    const items = await getLocalTable('local_items');
    const item = items.find(i => i.id === id);
    if (item) {
      if (isImageRef(item.image_url)) {
        await deleteImage(item.image_url);
      }
      await saveLocalAuditEntry('DELETE_ITEM', `Deleted item: ${item.name}`);
    }
    await setLocalTable('local_items', items.filter(i => i.id !== id));
    return { success: true };
  }

  const response = await fetch(`/api/items/${id}`, { method: 'DELETE' });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 11. GET AUDIT LOG
 */
export async function getAuditLog() {
  if (isLocalOnly()) {
    await consolidateLocalAuditLog();
    await cleanupLocalQuarantine();
    const log = await getLocalTable('local_audit_log');
    const sorted = [...log].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { entries: sorted };
  }

  const response = await fetch('/api/audit');
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return { entries: data.entries || [] };
}

/**
 * 12. RESTORE AUDIT ENTRY
 */
export async function restoreAuditEntry(id) {
  if (isLocalOnly()) {
    const log = await getLocalTable('local_audit_log');
    const entry = log.find(e => e.id === id);
    if (!entry) throw new Error('Audit entry not found');

    const bins = JSON.parse(entry.bins_snapshot);
    const items = JSON.parse(entry.items_snapshot);

    // DELETE_BIN snapshots are captured after the bin's items were batch-deleted
    // but before the bin itself is removed, so items_snapshot is empty; recover
    // the bin's items from earlier snapshots to restore it with its contents.
    let restoredItems = items;
    if (entry.operation === 'DELETE_BIN') {
      const sortedLog = [...log].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const idx = sortedLog.findIndex(e => e.id === id);
      const restoredBinIds = bins.map(b => b.id);
      const recovered = new Map();
      for (let j = idx - 1; j >= 0; j--) {
        const snapItems = JSON.parse(sortedLog[j].items_snapshot || '[]');
        for (const it of snapItems) {
          if (restoredBinIds.includes(it.bin_id) && !recovered.has(it.id)) {
            recovered.set(it.id, it);
          }
        }
      }
      const currentItems = await getLocalTable('local_items');
      restoredItems = [
        ...recovered.values(),
        ...currentItems.filter(ci => !recovered.has(ci.id))
      ];
    }

    await setLocalTable('local_bins', bins);
    await setLocalTable('local_items', restoredItems);
    await saveLocalAuditEntry('RESTORE', `Restored to: ${entry.description}`);
    return { success: true };
  }

  const response = await fetch(`/api/audit/restore/${id}`, { method: 'POST' });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 13. CHERRY PICK AUDIT ENTRY (INDIVIDUAL ITEMS/BINS)
 */
export async function cherryPickAuditEntry(id, binIds = [], itemIds = []) {
  if (isLocalOnly()) {
    const log = await getLocalTable('local_audit_log');
    const entry = log.find(e => e.id === id);
    if (!entry) throw new Error('Audit entry not found');

    const snapBins = JSON.parse(entry.bins_snapshot);
    const snapItems = JSON.parse(entry.items_snapshot);

    const currentBins = await getLocalTable('local_bins');
    const currentItems = await getLocalTable('local_items');

    // Merge picked bins (overwrite on ID conflict)
    const pickedBins = snapBins.filter(b => binIds.includes(b.id));
    const mergedBins = [
      ...pickedBins,
      ...currentBins.filter(cb => !pickedBins.some(pb => pb.id === cb.id))
    ];

    // Merge picked items (overwrite on ID conflict)
    const pickedItems = snapItems.filter(i => itemIds.includes(i.id));
    let mergedItems = [
      ...pickedItems,
      ...currentItems.filter(ci => !pickedItems.some(pi => pi.id === ci.id))
    ];

    // DELETE_BIN snapshots omit the bin's items (batch-deleted first); recover them from earlier snapshots.
    if (entry.operation === 'DELETE_BIN') {
      const sortedLog = [...log].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const idx = sortedLog.findIndex(e => e.id === id);
      const recovered = new Map();
      for (let j = idx - 1; j >= 0; j--) {
        const snap = JSON.parse(sortedLog[j].items_snapshot || '[]');
        for (const it of snap) {
          if (binIds.includes(it.bin_id) && !recovered.has(it.id)) {
            recovered.set(it.id, it);
          }
        }
      }
      mergedItems = [
        ...recovered.values(),
        ...mergedItems.filter(ci => !recovered.has(ci.id))
      ];
    }

    await setLocalTable('local_bins', mergedBins);
    await setLocalTable('local_items', mergedItems);
    await saveLocalAuditEntry('CHERRY_PICK', `Cherry picked ${pickedBins.length} bin(s) and ${pickedItems.length} item(s) from checkpoint: ${entry.description}`);
    return { success: true };
  }

  const response = await fetch(`/api/audit/cherry-pick/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bin_ids: binIds, item_ids: itemIds })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 14. RESTORE SELECTED HISTORICAL AUDIT LOG CHANGES CHRONOLOGICALLY
 */
export async function restoreSelectedChanges(ids) {
  if (isLocalOnly()) {
    const log = await getLocalTable('local_audit_log');
    // Sort log chronologically (ascending)
    const sortedLog = [...log].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const binsToRestoreMap = new Map();
    const itemsToRestoreMap = new Map();

    const currentBins = await getLocalTable('local_bins');
    const currentItems = await getLocalTable('local_items');

    for (const id of ids) {
      const idx = sortedLog.findIndex(e => e.id === id);
      if (idx === -1) continue;

      const entry = sortedLog[idx];
      const predecessor = idx > 0 ? sortedLog[idx - 1] : null;

      const binsE = JSON.parse(entry.bins_snapshot || '[]');
      const itemsE = JSON.parse(entry.items_snapshot || '[]');
      const binsP = predecessor ? JSON.parse(predecessor.bins_snapshot || '[]') : [];
      const itemsP = predecessor ? JSON.parse(predecessor.items_snapshot || '[]') : [];

      if (entry.operation === 'CREATE_BIN' || entry.operation === 'EDIT_BIN') {
        for (const b of binsE) {
          const prev = binsP.find(pb => pb.id === b.id);
          if (!prev || prev.name !== b.name || prev.location !== b.location || prev.image_url !== b.image_url) {
            binsToRestoreMap.set(b.id, b);
          }
        }
      } else if (entry.operation === 'DELETE_BIN') {
        for (const p of binsP) {
          if (!currentBins.some(cb => cb.id === p.id)) {
            binsToRestoreMap.set(p.id, p);
          }
        }

        const restoredBinIds = [...binsToRestoreMap.keys()];
        if (restoredBinIds.length > 0) {
          const recovered = new Map();
          for (let j = idx - 1; j >= 0; j--) {
            const snapItems = JSON.parse(sortedLog[j].items_snapshot || '[]');
            for (const it of snapItems) {
              if (restoredBinIds.includes(it.bin_id) && !recovered.has(it.id)) {
                recovered.set(it.id, it);
              }
            }
          }
          for (const [itemId, item] of recovered) {
            if (!currentItems.some(ci => ci.id === itemId)) {
              itemsToRestoreMap.set(itemId, item);
            }
          }
        }
      } else if (entry.operation === 'CREATE_ITEM' || entry.operation === 'EDIT_ITEM') {
        for (const i of itemsE) {
          const prev = itemsP.find(pi => pi.id === i.id);
          if (!prev || prev.name !== i.name || prev.description !== i.description || prev.bin_id !== i.bin_id || prev.image_url !== i.image_url || prev.visible_text !== i.visible_text || JSON.stringify(prev.search_tags) !== JSON.stringify(i.search_tags)) {
            itemsToRestoreMap.set(i.id, i);
          }
        }
      } else if (entry.operation === 'DELETE_ITEM') {
        for (const p of itemsP) {
          if (!itemsE.some(ie => ie.id === p.id)) {
            itemsToRestoreMap.set(p.id, p);
          }
        }
      } else {
        for (const b of binsE) {
          const prev = binsP.find(pb => pb.id === b.id);
          if (!prev || prev.name !== b.name || prev.location !== b.location || prev.image_url !== b.image_url) {
            binsToRestoreMap.set(b.id, b);
          }
        }
        for (const i of itemsE) {
          const prev = itemsP.find(pi => pi.id === i.id);
          if (!prev || prev.name !== i.name || prev.description !== i.description || prev.bin_id !== i.bin_id || prev.image_url !== i.image_url || prev.visible_text !== i.visible_text || JSON.stringify(prev.search_tags) !== JSON.stringify(i.search_tags)) {
            itemsToRestoreMap.set(i.id, i);
          }
        }
      }
    }

    const binsToRestore = Array.from(binsToRestoreMap.values());
    const itemsToRestore = Array.from(itemsToRestoreMap.values());

    if (binsToRestore.length === 0 && itemsToRestore.length === 0) {
      return { success: true, binsCount: 0, itemsCount: 0 };
    }

    const conflicts = [];
    const futureBinIds = new Set([
      ...currentBins.map(b => b.id),
      ...binsToRestore.map(b => b.id)
    ]);

    const futureQrIds = new Map();
    for (const b of currentBins) {
      futureQrIds.set(b.qr_id, b.id);
    }
    for (const b of binsToRestore) {
      const existingId = futureQrIds.get(b.qr_id);
      if (existingId && existingId !== b.id) {
        conflicts.push(`QR Code Conflict: QR Code "${b.qr_id}" is already used by another bin.`);
      } else {
        futureQrIds.set(b.qr_id, b.id);
      }
    }

    for (const item of itemsToRestore) {
      if (!futureBinIds.has(item.bin_id)) {
        conflicts.push(`Orphaned Item Conflict: Item "${item.name}" belongs to Bin ID "${item.bin_id}", which does not exist in the database. Please select the change that creates/restores this bin.`);
      }
    }

    if (conflicts.length > 0) {
      throw { conflicts };
    }

    // Merge picked bins
    const mergedBins = [
      ...binsToRestore,
      ...currentBins.filter(cb => !binsToRestore.some(pb => pb.id === cb.id))
    ];

    // Merge picked items
    const mergedItems = [
      ...itemsToRestore,
      ...currentItems.filter(ci => !itemsToRestore.some(pi => pi.id === ci.id))
    ];

    await setLocalTable('local_bins', mergedBins);
    await setLocalTable('local_items', mergedItems);
    await saveLocalAuditEntry('CHERRY_PICK', `Restored ${binsToRestore.length} bin(s) and ${itemsToRestore.length} item(s) by selective cherry-pick`);
    return { success: true, binsCount: binsToRestore.length, itemsCount: itemsToRestore.length };
  }

  const response = await fetch('/api/audit/restore-selected-changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  if (response.status === 409) {
    const data = await response.json();
    throw { conflicts: data.conflicts };
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 15. BATCH DELETE BINS
 */
export async function batchDeleteBins(binIds) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const items = await getLocalTable('local_items');

    for (const id of binIds) {
      const binItems = items.filter(i => i.bin_id === id);
      if (binItems.length > 0) {
        const bin = bins.find(b => b.id === id);
        const err = new Error(`Cannot delete bin "${bin ? bin.name : id}": it contains ${binItems.length} item(s). Manage them first.`);
        err.item_count = binItems.length;
        err.blocked = true;
        throw err;
      }
    }

    const deletedNames = [];
    for (const id of binIds) {
      const bin = bins.find(b => b.id === id);
      if (bin) {
        if (isImageRef(bin.image_url)) {
          await deleteImage(bin.image_url);
        }
        deletedNames.push(bin.name);
      }
    }

    await setLocalTable('local_bins', bins.filter(b => !binIds.includes(b.id)));
    await saveLocalAuditEntry('BATCH_DELETE_BINS', `Batch deleted ${binIds.length} bin(s): ${deletedNames.join(', ')}`);
    return { success: true };
  }

  const response = await fetch('/api/bins/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', bin_ids: binIds })
  });
  const data = await response.json();
  if (data.blocked) {
    const err = new Error(`Cannot delete bin: it contains ${data.item_count} item(s). Manage them first.`);
    err.item_count = data.item_count;
    err.blocked = true;
    throw err;
  }
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 16. BATCH UPDATE BIN LOCATIONS
 */
export async function batchUpdateBinLocations(binIds, location) {
  if (isLocalOnly()) {
    const bins = await getLocalTable('local_bins');
    const updated = bins.map(bin => {
      if (binIds.includes(bin.id)) {
        return { ...bin, location: location.trim() };
      }
      return bin;
    });
    await setLocalTable('local_bins', updated);
    await saveLocalAuditEntry('BATCH_UPDATE_LOCATIONS', `Batch updated location to "${location}" for ${binIds.length} bin(s)`);
    return { success: true };
  }

  const response = await fetch('/api/bins/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_location', bin_ids: binIds, location })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 17. BATCH DELETE ITEMS
 */
export async function batchDeleteItems(itemIds) {
  if (isLocalOnly()) {
    const items = await getLocalTable('local_items');
    const toDelete = items.filter(i => itemIds.includes(i.id));
    for (const i of toDelete) {
      if (isImageRef(i.image_url)) {
        await deleteImage(i.image_url);
      }
    }
    await setLocalTable('local_items', items.filter(i => !itemIds.includes(i.id)));

    const names = toDelete.map(i => i.name).join(', ');
    await saveLocalAuditEntry('BATCH_DELETE_ITEMS', `Batch deleted ${itemIds.length} item(s): ${names}`);
    return { success: true };
  }

  const response = await fetch('/api/items/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', item_ids: itemIds })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

/**
 * 18. BATCH MOVE ITEMS
 */
export async function batchMoveItems(itemIds, targetBinId) {
  if (isLocalOnly()) {
    const items = await getLocalTable('local_items');
    const updated = items.map(item => {
      if (itemIds.includes(item.id)) {
        return { ...item, bin_id: targetBinId };
      }
      return item;
    });
    await setLocalTable('local_items', updated);
    await saveLocalAuditEntry('BATCH_MOVE_ITEMS', `Batch moved ${itemIds.length} item(s) to bin ${targetBinId}`);
    return { success: true };
  }

  const response = await fetch('/api/items/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reassign', item_ids: itemIds, target_bin_id: targetBinId })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message);
  return data;
}
