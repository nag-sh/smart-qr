import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { initDb, getDb, closeDb } from './db.js';
import * as archiverNamespace from 'archiver';
const archiver = (format, options) => {
  if (format !== 'zip') throw new Error(`Unsupported archive format: ${format}`);
  return new archiverNamespace.ZipArchive(options);
};
import unzipper from 'unzipper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper: read an upload-path image and return a base64 data URL (or null)
const imagePathToDataURL = (imageUrl) => {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('data:')) return imageUrl; // already embedded
  // Strip leading slash and resolve to uploads dir
  const filename = path.basename(imageUrl);
  const fullPath = path.join(__dirname, 'uploads', filename);
  if (!fs.existsSync(fullPath)) return null;
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const data = fs.readFileSync(fullPath).toString('base64');
  return `data:${mime};base64,${data}`;
};

// Helper: write a base64 data URL to the uploads dir and return the /uploads/ path
const dataURLToFile = (dataURL) => {
  if (!dataURL || !dataURL.startsWith('data:')) return dataURL; // already a path
  const matches = dataURL.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return null;
  const mime = matches[1];
  const data = matches[2];
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const filename = `${uuidv4()}.${ext}`;
  const destPath = path.join(__dirname, 'uploads', filename);
  fs.writeFileSync(destPath, Buffer.from(data, 'base64'));
  return `/uploads/${filename}`;
};

const getFileExtension = (filename) => {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
};

class BackupValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Helper: embed JSON metadata into EXIF ImageDescription of a JPEG/PNG file
const embedImageMetadata = async (inputPath, metadata) => {
  try {
    const buffer = await sharp(inputPath)
      .withMetadata({ exif: { IFD0: { ImageDescription: JSON.stringify(metadata) } } })
      .toBuffer();
    fs.writeFileSync(inputPath, buffer);
  } catch (err) {
    console.error('[embedImageMetadata] Failed to embed metadata:', err.message);
    // Never throw — metadata failure must not block the save
  }
};

// Helper: save an audit log entry
const saveAuditEntry = async (db, operation, description) => {
  try {
    const bins = await db.all('SELECT id, qr_id, name, location, image_url, created_at FROM bins ORDER BY created_at DESC');
    const items = await db.all('SELECT id, bin_id, name, description, image_url, search_tags, visible_text, created_at FROM items ORDER BY created_at DESC');
    await db.run(
      `INSERT INTO audit_log (id, operation, description, bins_snapshot, items_snapshot, created_at, granularity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      uuidv4(),
      operation,
      description,
      JSON.stringify(bins),
      JSON.stringify(items),
      new Date().toISOString(),
      'individual'
    );
  } catch (err) {
    console.error('[saveAuditEntry] Failed to save audit entry:', err.message);
  }
};

// Helper: consolidate audit log (deduplicate old entries by day/week)
const consolidateAuditLog = async (db) => {
  try {
    await db.run('BEGIN TRANSACTION');
    try {
      // Between 24h and 7d ago — keep only the latest per calendar day
      const dailyDays = await db.all(`
        SELECT DISTINCT strftime('%Y-%m-%d', created_at) as day
        FROM audit_log
        WHERE created_at < datetime('now', '-1 day')
          AND created_at >= datetime('now', '-7 days')
      `);
      for (const { day } of dailyDays) {
        const maxRow = await db.get(`
          SELECT id FROM audit_log
          WHERE strftime('%Y-%m-%d', created_at) = ?
            AND created_at < datetime('now', '-1 day')
            AND created_at >= datetime('now', '-7 days')
          ORDER BY created_at DESC LIMIT 1
        `, day);
        if (maxRow) {
          await db.run(`
            DELETE FROM audit_log
            WHERE strftime('%Y-%m-%d', created_at) = ?
              AND created_at < datetime('now', '-1 day')
              AND created_at >= datetime('now', '-7 days')
              AND id != ?
          `, day, maxRow.id);
          await db.run(`
            UPDATE audit_log SET granularity = 'daily' WHERE id = ?
          `, maxRow.id);
        }
      }

      // Older than 7d — keep only the latest per ISO week
      const weeklyWeeks = await db.all(`
        SELECT DISTINCT strftime('%Y-%W', created_at) as week
        FROM audit_log
        WHERE created_at < datetime('now', '-7 days')
      `);
      for (const { week } of weeklyWeeks) {
        const maxRow = await db.get(`
          SELECT id FROM audit_log
          WHERE strftime('%Y-%W', created_at) = ?
            AND created_at < datetime('now', '-7 days')
          ORDER BY created_at DESC LIMIT 1
        `, week);
        if (maxRow) {
          await db.run(`
            DELETE FROM audit_log
            WHERE strftime('%Y-%W', created_at) = ?
              AND created_at < datetime('now', '-7 days')
              AND id != ?
          `, week, maxRow.id);
          await db.run(`
            UPDATE audit_log SET granularity = 'weekly' WHERE id = ?
          `, maxRow.id);
        }
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('[consolidateAuditLog] Failed:', err.message);
  }
};

// Helper: move an image path to the quarantine table
const quarantineImage = async (db, imageUrl) => {
  if (!imageUrl) return;
  if (imageUrl.startsWith('data:')) return;
  if (!imageUrl.startsWith('/uploads/')) return;
  try {
    await db.run(
      `INSERT INTO image_quarantine (id, image_path, quarantined_at) VALUES (?, ?, ?)`,
      uuidv4(),
      imageUrl,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[quarantineImage] Failed:', err.message);
  }
};

// Helper: delete quarantined images older than 72 hours
const cleanupQuarantinedImages = async (db) => {
  try {
    const stale = await db.all(`
      SELECT * FROM image_quarantine
      WHERE quarantined_at < datetime('now', '-72 hours')
    `);
    for (const row of stale) {
      try {
        const filePath = path.join(__dirname, row.image_path);
        fs.unlinkSync(filePath);
      } catch (_) {
        // File may already be gone
      }
    }
    if (stale.length > 0) {
      const ids = stale.map(() => '?').join(',');
      await db.run(
        `DELETE FROM image_quarantine WHERE id IN (${ids})`,
        ...stale.map(r => r.id)
      );
      console.log(`[cleanupQuarantinedImages] Removed ${stale.length} quarantined file(s).`);
    }
  } catch (err) {
    console.error('[cleanupQuarantinedImages] Failed:', err.message);
  }
};

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(express.json());

// Serve uploads statically
app.use('/uploads', express.static(uploadsDir));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

// ============================================================
// Endpoints
// ============================================================

// 1. GET bin by QR ID or database ID (includes all items in that bin)
app.get('/api/bins/:qr_id', async (req, res) => {
  try {
    const { qr_id } = req.params;
    const db = getDb();

    // Check by QR ID first, then fall back to database ID
    let bin = await db.get('SELECT * FROM bins WHERE qr_id = ?', qr_id);
    if (!bin) {
      bin = await db.get('SELECT * FROM bins WHERE id = ?', qr_id);
    }

    if (!bin) {
      return res.status(404).json({ success: false, message: 'Bin not found' });
    }

    const items = await db.all('SELECT * FROM items WHERE bin_id = ? ORDER BY created_at DESC', bin.id);

    // Parse search_tags from stringified JSON for each item
    const parsedItems = items.map(item => ({
      ...item,
      search_tags: item.search_tags ? JSON.parse(item.search_tags) : []
    }));

    res.json({ success: true, bin, items: parsedItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error retrieving bin' });
  }
});

// 2. POST create a new bin
app.post('/api/bins', upload.single('image'), async (req, res) => {
  try {
    const { qr_id, name, location } = req.body;
    if (!qr_id || !name || !location) {
      return res.status(400).json({ success: false, message: 'Missing required fields: qr_id, name, location' });
    }

    const db = getDb();
    // Check if bin with qr_id already exists
    const existing = await db.get('SELECT id FROM bins WHERE qr_id = ?', qr_id);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Bin with this QR ID already exists' });
    }

    const id = uuidv4();
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    const created_at = new Date().toISOString();

    await db.run(`
      INSERT INTO bins (id, qr_id, name, location, image_url)
      VALUES (?, ?, ?, ?, ?)
    `, id, qr_id, name, location, image_url);

    // Embed image metadata if an image was uploaded
    if (req.file) {
      const fullImagePath = path.join(__dirname, 'uploads', req.file.filename);
      await embedImageMetadata(fullImagePath, {
        app: 'smart-qr-inventory',
        owner: 'dion',
        entity_type: 'bin',
        entity_id: id,
        entity_name: name,
        qr_id: qr_id,
        created_at
      });
    }

    await saveAuditEntry(db, 'CREATE_BIN', `Created bin '${name}'`);

    const newBin = await db.get('SELECT * FROM bins WHERE id = ?', id);
    res.status(201).json({ success: true, bin: newBin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error creating bin' });
  }
});

// PUT /api/bins/:id — edit a bin
app.put('/api/bins/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location } = req.body;
    const db = getDb();

    const existingBin = await db.get('SELECT * FROM bins WHERE id = ?', id);
    if (!existingBin) {
      return res.status(404).json({ success: false, message: 'Bin not found' });
    }

    let image_url = existingBin.image_url;

    if (req.file) {
      // Quarantine the old image
      await quarantineImage(db, existingBin.image_url);
      image_url = `/uploads/${req.file.filename}`;
      const fullImagePath = path.join(__dirname, 'uploads', req.file.filename);
      await embedImageMetadata(fullImagePath, {
        app: 'smart-qr-inventory',
        owner: 'dion',
        entity_type: 'bin',
        entity_id: id,
        entity_name: name || existingBin.name,
        qr_id: existingBin.qr_id,
        created_at: new Date().toISOString()
      });
    }

    await db.run(
      `UPDATE bins SET name = ?, location = ?, image_url = ? WHERE id = ?`,
      name || existingBin.name,
      location || existingBin.location,
      image_url,
      id
    );

    await saveAuditEntry(db, 'EDIT_BIN', `Edited bin '${name || existingBin.name}'`);

    const updatedBin = await db.get('SELECT * FROM bins WHERE id = ?', id);
    res.json({ success: true, bin: updatedBin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error editing bin' });
  }
});

// DELETE /api/bins/:id — delete a bin (only if empty)
app.delete('/api/bins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const bin = await db.get('SELECT * FROM bins WHERE id = ?', id);
    if (!bin) {
      return res.status(404).json({ success: false, message: 'Bin not found' });
    }

    const { item_count } = await db.get('SELECT COUNT(*) as item_count FROM items WHERE bin_id = ?', id);
    if (item_count > 0) {
      return res.status(409).json({
        success: false,
        blocked: true,
        item_count,
        message: `Bin still contains ${item_count} item${item_count !== 1 ? 's' : ''}`
      });
    }

    await quarantineImage(db, bin.image_url);
    await db.run('DELETE FROM bins WHERE id = ?', id);
    await saveAuditEntry(db, 'DELETE_BIN', `Deleted bin '${bin.name}'`);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error deleting bin' });
  }
});

// POST /api/bins/:id/batch — batch reassign or delete items in a bin
app.post('/api/bins/:id/batch', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, item_ids = [], target_bin_id } = req.body;
    const db = getDb();

    if (!action || !['reassign', 'delete'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be reassign or delete.' });
    }
    if (!item_ids.length) {
      return res.status(400).json({ success: false, message: 'No item_ids provided' });
    }

    if (action === 'reassign') {
      if (!target_bin_id) {
        return res.status(400).json({ success: false, message: 'target_bin_id required for reassign' });
      }
      const targetBin = await db.get('SELECT id FROM bins WHERE id = ?', target_bin_id);
      if (!targetBin) {
        return res.status(404).json({ success: false, message: 'Target bin not found' });
      }
      const placeholders = item_ids.map(() => '?').join(',');
      await db.run(
        `UPDATE items SET bin_id = ? WHERE id IN (${placeholders})`,
        target_bin_id,
        ...item_ids
      );
    } else if (action === 'delete') {
      for (const itemId of item_ids) {
        const item = await db.get('SELECT image_url FROM items WHERE id = ?', itemId);
        if (item) await quarantineImage(db, item.image_url);
      }
      const placeholders = item_ids.map(() => '?').join(',');
      await db.run(`DELETE FROM items WHERE id IN (${placeholders})`, ...item_ids);
    }

    await saveAuditEntry(db, 'BATCH_ITEMS', `Batch ${action} of ${item_ids.length} items from bin`);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error processing batch action' });
  }
});

// 5. GET all bins (with item counts)
app.get('/api/bins', async (req, res) => {
  try {
    const db = getDb();
    const bins = await db.all(`
      SELECT bins.*, COUNT(items.id) as item_count
      FROM bins
      LEFT JOIN items ON items.bin_id = bins.id
      GROUP BY bins.id
      ORDER BY bins.created_at DESC
    `);
    res.json({ success: true, bins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error retrieving bins' });
  }
});

// 3. POST create a new item
app.post('/api/items', upload.single('image'), async (req, res) => {
  try {
    const { bin_id, name, description, search_tags, visible_text } = req.body;
    if (!bin_id || !name) {
      return res.status(400).json({ success: false, message: 'Missing required fields: bin_id, name' });
    }

    const db = getDb();
    // Validate bin_id exists
    const bin = await db.get('SELECT * FROM bins WHERE id = ?', bin_id);
    if (!bin) {
      return res.status(404).json({ success: false, message: 'Parent bin not found' });
    }

    const id = uuidv4();
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    const created_at = new Date().toISOString();

    // search_tags can be passed as JSON string or array, standard multipart forms send as string
    let tagsString = null;
    if (search_tags) {
      if (typeof search_tags === 'string') {
        try {
          JSON.parse(search_tags);
          tagsString = search_tags;
        } catch {
          tagsString = JSON.stringify(search_tags.split(',').map(t => t.trim()));
        }
      } else {
        tagsString = JSON.stringify(search_tags);
      }
    }

    await db.run(`
      INSERT INTO items (id, bin_id, name, description, image_url, search_tags, visible_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, id, bin_id, name, description || '', image_url, tagsString, visible_text || '');

    // Embed image metadata if an image was uploaded
    if (req.file) {
      const fullImagePath = path.join(__dirname, 'uploads', req.file.filename);
      await embedImageMetadata(fullImagePath, {
        app: 'smart-qr-inventory',
        owner: 'dion',
        entity_type: 'item',
        entity_id: id,
        entity_name: name,
        bin_id: bin_id,
        bin_name: bin.name,
        created_at
      });
    }

    await saveAuditEntry(db, 'CREATE_ITEM', `Added item '${name}' to bin '${bin.name}'`);

    const newItem = await db.get('SELECT * FROM items WHERE id = ?', id);
    const parsedItem = {
      ...newItem,
      search_tags: newItem.search_tags ? JSON.parse(newItem.search_tags) : []
    };

    res.status(201).json({ success: true, item: parsedItem });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error creating item' });
  }
});

// PUT /api/items/:id — edit an item
app.put('/api/items/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, search_tags, visible_text } = req.body;
    const db = getDb();

    const existingItem = await db.get('SELECT * FROM items WHERE id = ?', id);
    if (!existingItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const bin = await db.get('SELECT * FROM bins WHERE id = ?', existingItem.bin_id);

    let image_url = existingItem.image_url;

    if (req.file) {
      await quarantineImage(db, existingItem.image_url);
      image_url = `/uploads/${req.file.filename}`;
      const fullImagePath = path.join(__dirname, 'uploads', req.file.filename);
      await embedImageMetadata(fullImagePath, {
        app: 'smart-qr-inventory',
        owner: 'dion',
        entity_type: 'item',
        entity_id: id,
        entity_name: name || existingItem.name,
        bin_id: existingItem.bin_id,
        bin_name: bin ? bin.name : '',
        created_at: new Date().toISOString()
      });
    }

    // Parse search_tags
    let tagsString = existingItem.search_tags;
    if (search_tags !== undefined) {
      if (typeof search_tags === 'string') {
        try {
          JSON.parse(search_tags);
          tagsString = search_tags;
        } catch {
          tagsString = JSON.stringify(search_tags.split(',').map(t => t.trim()));
        }
      } else {
        tagsString = JSON.stringify(search_tags);
      }
    }

    const updatedName = name !== undefined ? name : existingItem.name;
    const updatedDescription = description !== undefined ? description : existingItem.description;
    const updatedVisibleText = visible_text !== undefined ? visible_text : existingItem.visible_text;

    await db.run(
      `UPDATE items SET name = ?, description = ?, image_url = ?, search_tags = ?, visible_text = ? WHERE id = ?`,
      updatedName,
      updatedDescription,
      image_url,
      tagsString,
      updatedVisibleText,
      id
    );

    await saveAuditEntry(db, 'EDIT_ITEM', `Edited item '${updatedName}'`);

    const updatedItem = await db.get('SELECT * FROM items WHERE id = ?', id);
    res.json({
      success: true,
      item: {
        ...updatedItem,
        search_tags: updatedItem.search_tags ? JSON.parse(updatedItem.search_tags) : []
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error editing item' });
  }
});

// DELETE /api/items/:id — delete a single item
app.delete('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const item = await db.get('SELECT * FROM items WHERE id = ?', id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    await quarantineImage(db, item.image_url);
    await db.run('DELETE FROM items WHERE id = ?', id);
    await saveAuditEntry(db, 'DELETE_ITEM', `Deleted item '${item.name}'`);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error deleting item' });
  }
});

// 4. GET search items across FTS5
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    const db = getDb();

    if (!q || !q.trim()) {
      // Return all items if query is empty
      const items = await db.all(`
        SELECT items.*, bins.name as bin_name, bins.location as bin_location
        FROM items
        JOIN bins ON bins.id = items.bin_id
        ORDER BY items.created_at DESC
      `);

      const parsedItems = items.map(item => ({
        ...item,
        search_tags: item.search_tags ? JSON.parse(item.search_tags) : []
      }));

      return res.json({ success: true, items: parsedItems });
    }

    // Clean and split query terms to support prefix AND search
    const cleanQuery = q.trim().replace(/[^\w\s-]/g, '');
    if (!cleanQuery) {
      return res.json({ success: true, items: [] });
    }

    const ftsQuery = cleanQuery
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map(word => `${word}*`)
      .join(' AND ');

    const items = await db.all(`
      SELECT items.*, bins.name as bin_name, bins.location as bin_location
      FROM items_fts
      JOIN items ON items.id = items_fts.item_id
      JOIN bins ON bins.id = items.bin_id
      WHERE items_fts MATCH ?
      ORDER BY rank
    `, ftsQuery);

    const parsedItems = items.map(item => ({
      ...item,
      search_tags: item.search_tags ? JSON.parse(item.search_tags) : []
    }));

    res.json({ success: true, items: parsedItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error searching items' });
  }
});

// 16. POST /api/bins/batch — batch delete or update location for bins
app.post('/api/bins/batch', async (req, res) => {
  try {
    const { action, bin_ids = [], location } = req.body;
    const db = getDb();

    if (!action || !['delete', 'update_location'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be delete or update_location.' });
    }
    if (!bin_ids.length) {
      return res.status(400).json({ success: false, message: 'No bin_ids provided' });
    }

    if (action === 'delete') {
      // Pre-check all bins have no items before mutating
      for (const binId of bin_ids) {
        const bin = await db.get('SELECT * FROM bins WHERE id = ?', binId);
        if (!bin) {
          return res.status(404).json({ success: false, message: `Bin ${binId} not found` });
        }
        const { item_count } = await db.get('SELECT COUNT(*) as item_count FROM items WHERE bin_id = ?', binId);
        if (item_count > 0) {
          return res.status(409).json({
            success: false,
            blocked: true,
            item_count,
            message: `Bin '${bin.name}' still contains ${item_count} item${item_count !== 1 ? 's' : ''}`
          });
        }
      }

      await db.run('BEGIN TRANSACTION');
      try {
        for (const binId of bin_ids) {
          const bin = await db.get('SELECT image_url FROM bins WHERE id = ?', binId);
          if (bin) await quarantineImage(db, bin.image_url);
          await db.run('DELETE FROM bins WHERE id = ?', binId);
        }
        await db.run('COMMIT');
      } catch (txErr) {
        await db.run('ROLLBACK');
        throw txErr;
      }

      await saveAuditEntry(db, 'BATCH_DELETE_BINS', `Batch deleted ${bin_ids.length} bin(s)`);
      res.json({ success: true, affected: bin_ids.length });
    } else if (action === 'update_location') {
      if (!location) {
        return res.status(400).json({ success: false, message: 'location required for update_location' });
      }

      await db.run('BEGIN TRANSACTION');
      try {
        const placeholders = bin_ids.map(() => '?').join(',');
        await db.run(
          `UPDATE bins SET location = ? WHERE id IN (${placeholders})`,
          location,
          ...bin_ids
        );
        await db.run('COMMIT');
      } catch (txErr) {
        await db.run('ROLLBACK');
        throw txErr;
      }

      await saveAuditEntry(db, 'BATCH_UPDATE_BIN_LOCATION', `Batch updated location for ${bin_ids.length} bin(s)`);
      res.json({ success: true, affected: bin_ids.length });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error processing batch bin action' });
  }
});

// 17. POST /api/items/batch — batch delete or reassign items
app.post('/api/items/batch', async (req, res) => {
  try {
    const { action, item_ids = [], target_bin_id } = req.body;
    const db = getDb();

    if (!action || !['delete', 'reassign'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be delete or reassign.' });
    }
    if (!item_ids.length) {
      return res.status(400).json({ success: false, message: 'No item_ids provided' });
    }

    if (action === 'delete') {
      await db.run('BEGIN TRANSACTION');
      try {
        for (const itemId of item_ids) {
          const item = await db.get('SELECT image_url FROM items WHERE id = ?', itemId);
          if (item) await quarantineImage(db, item.image_url);
        }
        const placeholders = item_ids.map(() => '?').join(',');
        await db.run(`DELETE FROM items WHERE id IN (${placeholders})`, ...item_ids);
        await db.run('COMMIT');
      } catch (txErr) {
        await db.run('ROLLBACK');
        throw txErr;
      }

      await saveAuditEntry(db, 'BATCH_DELETE_ITEMS', `Batch deleted ${item_ids.length} item(s)`);
      res.json({ success: true, affected: item_ids.length });
    } else if (action === 'reassign') {
      if (!target_bin_id) {
        return res.status(400).json({ success: false, message: 'target_bin_id required for reassign' });
      }
      const targetBin = await db.get('SELECT id, name FROM bins WHERE id = ?', target_bin_id);
      if (!targetBin) {
        return res.status(404).json({ success: false, message: 'Target bin not found' });
      }

      await db.run('BEGIN TRANSACTION');
      try {
        const placeholders = item_ids.map(() => '?').join(',');
        await db.run(
          `UPDATE items SET bin_id = ? WHERE id IN (${placeholders})`,
          target_bin_id,
          ...item_ids
        );
        await db.run('COMMIT');
      } catch (txErr) {
        await db.run('ROLLBACK');
        throw txErr;
      }

      await saveAuditEntry(db, 'BATCH_REASSIGN_ITEMS', `Batch reassigned ${item_ids.length} item(s) to bin '${targetBin.name}'`);
      res.json({ success: true, affected: item_ids.length });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error processing batch item action' });
  }
});

// 6. GET export inventory data as a .zip (JSON + images tree)
export async function exportBackup(res, includeImages = true) {
  const db = getDb();
  const bins = await db.all('SELECT * FROM bins ORDER BY created_at DESC');
  const items = await db.all('SELECT * FROM items ORDER BY created_at DESC');

  const slugify = (str, fallback) => {
    const slug = String(str == null ? '' : str)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
    return slug || fallback || 'unknown';
  };

  const usedPaths = new Set();
  const uniquePath = (p) => {
    if (!usedPaths.has(p)) {
      usedPaths.add(p);
      return p;
    }
    const ext = path.extname(p);
    const base = p.slice(0, -ext.length) || p;
    let counter = 2;
    let candidate;
    do {
      candidate = `${base}-${counter}${ext}`;
      counter++;
    } while (usedPaths.has(candidate));
    usedPaths.add(candidate);
    return candidate;
  };

  const resolveImageSource = (imageUrl) => {
    if (!imageUrl) return null;
    if (imageUrl.startsWith('/uploads/')) {
      const filename = path.basename(imageUrl);
      const fullPath = path.join(uploadsDir, filename);
      if (fs.existsSync(fullPath)) {
        return { path: fullPath, ext: getFileExtension(filename) };
      }
      return null;
    }
    if (imageUrl.startsWith('data:')) {
      const serverPath = dataURLToFile(imageUrl);
      if (!serverPath) return null;
      const filename = path.basename(serverPath);
      const fullPath = path.join(uploadsDir, filename);
      if (fs.existsSync(fullPath)) {
        return { path: fullPath, ext: getFileExtension(filename) };
      }
      return null;
    }
    return null;
  };

  const binMap = new Map(bins.map(b => [b.id, b]));
  const exportedBins = [];
  const imageFiles = [];

  for (const bin of bins) {
    const locSlug = slugify(bin.location, 'unsorted-location');
    const binSlug = slugify(bin.name, bin.id);
    const exportedBin = { ...bin };
    let imageUrl = null;

    if (includeImages) {
      const source = resolveImageSource(bin.image_url);
      if (source) {
        const zipPath = uniquePath(`images/${locSlug}/${binSlug}/bin.${source.ext}`);
        imageFiles.push({ path: source.path, zipPath });
        imageUrl = zipPath;
      }
    }

    exportedBin.image_url = imageUrl;
    exportedBins.push(exportedBin);
  }

  const exportedItems = [];
  for (const item of items) {
    const bin = binMap.get(item.bin_id);
    const exportedItem = { ...item, search_tags: item.search_tags ? JSON.parse(item.search_tags) : [] };
    let imageUrl = null;

    if (includeImages && bin) {
      const locSlug = slugify(bin.location, 'unsorted-location');
      const binSlug = slugify(bin.name, bin.id);
      const itemSlug = slugify(item.name, item.id);
      const source = resolveImageSource(item.image_url);
      if (source) {
        const zipPath = uniquePath(`images/${locSlug}/${binSlug}/${itemSlug}.${source.ext}`);
        imageFiles.push({ path: source.path, zipPath });
        imageUrl = zipPath;
      }
    }

    exportedItem.image_url = imageUrl;
    exportedItems.push(exportedItem);
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    owner: 'dion',
    image_layout: 'images/<location>/<bin>/<item>.*',
    bins: exportedBins,
    items: exportedItems
  };

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="smart_qr_backup.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  await new Promise((resolve, reject) => {
    archive.on('error', reject);
    archive.on('finish', resolve);
    archive.pipe(res);
    archive.append(JSON.stringify(exportData, null, 2), { name: 'inventory.json' });
    for (const image of imageFiles) {
      archive.append(fs.readFileSync(image.path), { name: image.zipPath });
    }
    archive.finalize();
  });
}

app.get('/api/export/zip', async (req, res) => {
  try {
    const includeImages = req.query.includeImages !== 'false' && req.query.includeImages !== false && req.query.includeImages !== '0';
    await exportBackup(res, includeImages);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to export zip backup' });
    }
  }
});

// 7. POST import zip backup (JSON + images tree)
export async function importBackupZipFile(filePath) {
  const extractDir = path.join(__dirname, 'tmp_imports', uuidv4());
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    const inventoryPath = path.join(extractDir, 'inventory.json');
    if (!fs.existsSync(inventoryPath)) {
      throw new BackupValidationError('Invalid zip backup: inventory.json missing');
    }

    const data = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    if (!data.bins || !data.items) {
      throw new BackupValidationError('Invalid inventory.json format');
    }

    const resolveImportImageUrl = (imageUrl) => {
      if (!imageUrl) return null;
      if (imageUrl.startsWith('images/')) {
        const normalizedPath = imageUrl.replace(/\//g, path.sep);
        const fullPath = path.join(extractDir, normalizedPath);
        if (fs.existsSync(fullPath)) {
          const ext = getFileExtension(path.basename(fullPath));
          const filename = `${uuidv4()}.${ext}`;
          const destPath = path.join(uploadsDir, filename);
          fs.copyFileSync(fullPath, destPath);
          return `/uploads/${filename}`;
        }
        return null;
      }
      if (imageUrl.startsWith('data:')) {
        return dataURLToFile(imageUrl);
      }
      return imageUrl;
    };

    const db = getDb();

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM items');
      await db.run('DELETE FROM bins');

      for (const bin of data.bins) {
        const imageUrl = resolveImportImageUrl(bin.image_url);
        await db.run(
          `INSERT INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, imageUrl, bin.created_at
        );
      }

      for (const item of data.items) {
        const imageUrl = resolveImportImageUrl(item.image_url);
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, imageUrl, tagsString, item.visible_text, item.created_at
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'IMPORT_ZIP', `Imported zip backup (${data.bins.length} bins, ${data.items.length} items)`);

    return { success: true };
  } finally {
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[importBackupZipFile] Failed to clean up extract dir:', err.message);
    }
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('[importBackupZipFile] Failed to clean up uploaded zip file:', err.message);
    }
  }
}

app.post('/api/import/zip', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const result = await importBackupZipFile(req.file.path);
    res.json(result);
  } catch (err) {
    console.error('Zip import failed:', err);
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to import zip backup' });
    }
  }
});

// 8. POST import SQLite zip (DB file + uploads folder)
app.post('/api/import/db', upload.single('dbFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const dbFile = path.resolve(__dirname, 'inventory.db');

    // Close current DB connection before overwriting
    await closeDb();

    if (req.file.originalname.endsWith('.zip') || req.file.mimetype === 'application/zip') {
      // Extract zip: restore inventory.db and uploads/
      await new Promise((resolve, reject) => {
        fs.createReadStream(tempPath)
          .pipe(unzipper.Parse())
          .on('entry', entry => {
            const filePath = entry.path;
            if (filePath === 'inventory.db') {
              entry.pipe(fs.createWriteStream(dbFile));
            } else if (filePath.startsWith('uploads/') && filePath !== 'uploads/') {
              const dest = path.join(__dirname, filePath);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              entry.pipe(fs.createWriteStream(dest));
            } else {
              entry.autodrain();
            }
          })
          .on('close', resolve)
          .on('error', reject);
      });
    } else {
      // Plain .db file (legacy)
      fs.copyFileSync(tempPath, dbFile);
    }

    await initDb();
    const db = getDb();
    await saveAuditEntry(db, 'IMPORT_DB', 'Restored database from ZIP backup');
    fs.unlinkSync(tempPath);
    res.json({ success: true, message: 'Database and images restored successfully' });
  } catch (err) {
    console.error('Database import failed:', err);
    try { await initDb(); } catch (_) {}
    res.status(500).json({ success: false, message: 'Failed to import database backup' });
  }
});

// 9. POST import inventory data from JSON (base64 images decoded back to disk)
app.post('/api/import/json', upload.single('jsonFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tempPath = req.file.path;
    const content = fs.readFileSync(tempPath, 'utf8');
    const data = JSON.parse(content);

    if (!data.bins || !data.items) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ success: false, message: 'Invalid JSON backup format' });
    }

    const db = getDb();
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM items');
      await db.run('DELETE FROM bins');

      for (const bin of data.bins) {
        // Write embedded base64 image back to disk if present
        const savedImageUrl = bin.image_url && bin.image_url.startsWith('data:')
          ? dataURLToFile(bin.image_url)
          : bin.image_url;
        await db.run(
          `INSERT INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, savedImageUrl, bin.created_at
        );
      }

      for (const item of data.items) {
        const savedImageUrl = item.image_url && item.image_url.startsWith('data:')
          ? dataURLToFile(item.image_url)
          : item.image_url;
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, savedImageUrl, tagsString, item.visible_text, item.created_at
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'IMPORT_JSON', `Imported JSON backup (${data.bins.length} bins, ${data.items.length} items)`);
    fs.unlinkSync(tempPath);
    res.json({ success: true, message: 'Inventory JSON data imported successfully' });
  } catch (err) {
    console.error('JSON import failed:', err);
    res.status(500).json({ success: false, message: 'Failed to import JSON backup' });
  }
});

// 10. GET sync/pull — export full server DB state with embedded base64 images
app.get('/api/sync/pull', async (req, res) => {
  try {
    const db = getDb();
    const bins = await db.all('SELECT * FROM bins ORDER BY created_at DESC');
    const items = await db.all('SELECT * FROM items ORDER BY created_at DESC');

    const binsWithImages = bins.map(bin => ({
      ...bin,
      image_url: imagePathToDataURL(bin.image_url)
    }));
    const itemsWithImages = items.map(item => ({
      ...item,
      search_tags: item.search_tags ? JSON.parse(item.search_tags) : [],
      image_url: imagePathToDataURL(item.image_url)
    }));

    res.json({ success: true, bins: binsWithImages, items: itemsWithImages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to pull server data' });
  }
});

// 11. POST sync/push — receive local data (with base64 images) and merge into server DB
app.post('/api/sync/push', async (req, res) => {
  try {
    const { bins = [], items = [], deleteUnreferenced = false } = req.body;
    const db = getDb();

    await db.run('BEGIN TRANSACTION');
    try {
      if (deleteUnreferenced) {
        await db.run('DELETE FROM items');
        await db.run('DELETE FROM bins');
      }

      for (const bin of bins) {
        // Write base64 image to disk if present, else keep path as-is
        const savedImageUrl = bin.image_url && bin.image_url.startsWith('data:')
          ? dataURLToFile(bin.image_url)
          : bin.image_url;
        await db.run(
          `INSERT OR REPLACE INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, savedImageUrl, bin.created_at
        );
      }

      for (const item of items) {
        const savedImageUrl = item.image_url && item.image_url.startsWith('data:')
          ? dataURLToFile(item.image_url)
          : item.image_url;
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT OR REPLACE INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, savedImageUrl, tagsString, item.visible_text, item.created_at
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'SYNC_PUSH', `Synced local data to server (${bins.length} bins, ${items.length} items)`);
    res.json({ success: true, message: 'Local data pushed to server successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to push data to server' });
  }
});

// 12. GET audit log
app.get('/api/audit', async (req, res) => {
  try {
    const db = getDb();
    await consolidateAuditLog(db);
    const entries = await db.all('SELECT * FROM audit_log ORDER BY created_at DESC');
    res.json({ success: true, entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error retrieving audit log' });
  }
});

// 13. POST restore from audit log checkpoint
app.post('/api/audit/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const entry = await db.get('SELECT * FROM audit_log WHERE id = ?', id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Audit entry not found' });
    }

    const bins = JSON.parse(entry.bins_snapshot);
    const items = JSON.parse(entry.items_snapshot);

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM items');
      await db.run('DELETE FROM bins');

      for (const bin of bins) {
        await db.run(
          `INSERT INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, bin.image_url, bin.created_at
        );
      }

      for (const item of items) {
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, item.image_url, tagsString, item.visible_text, item.created_at
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'RESTORE', `Restored to checkpoint: ${entry.description}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error restoring checkpoint' });
  }
});

// 14. POST cherry pick individual items/bins from audit log checkpoint
app.post('/api/audit/cherry-pick/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { bin_ids = [], item_ids = [] } = req.body;
    const db = getDb();

    const entry = await db.get('SELECT * FROM audit_log WHERE id = ?', id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Audit entry not found' });
    }

    const bins = JSON.parse(entry.bins_snapshot);
    const items = JSON.parse(entry.items_snapshot);

    const selectedBins = bins.filter(b => bin_ids.includes(b.id));
    const selectedItems = items.filter(i => item_ids.includes(i.id));

    await db.run('BEGIN TRANSACTION');
    try {
      for (const bin of selectedBins) {
        await db.run(
          `INSERT OR REPLACE INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, bin.image_url, bin.created_at
        );
      }

      for (const item of selectedItems) {
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT OR REPLACE INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, item.image_url, tagsString, item.visible_text, item.created_at
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'CHERRY_PICK', `Cherry picked ${selectedBins.length} bin(s) and ${selectedItems.length} item(s) from checkpoint: ${entry.description}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error cherry picking checkpoint' });
  }
});

// 15. POST restore selected individual changes chronologically
app.post('/api/audit/restore-selected-changes', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or empty ids list' });
    }

    const db = getDb();

    // Fetch all audit log entries, ordered chronologically (created_at ASC)
    const allEntries = await db.all('SELECT * FROM audit_log ORDER BY created_at ASC');

    const binsToRestoreMap = new Map(); // id -> bin object
    const itemsToRestoreMap = new Map(); // id -> item object

    // Process selected entries chronologically
    for (const id of ids) {
      const idx = allEntries.findIndex(e => e.id === id);
      if (idx === -1) continue;

      const entry = allEntries[idx];
      const predecessor = idx > 0 ? allEntries[idx - 1] : null;

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
          if (!binsE.some(be => be.id === p.id)) {
            binsToRestoreMap.set(p.id, p);
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
        // Bulk or fallback
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
      return res.json({ success: true, binsCount: 0, itemsCount: 0 });
    }

    // Check conflicts against current database
    const currentBins = await db.all('SELECT * FROM bins');
    const currentItems = await db.all('SELECT * FROM items');

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
      return res.status(409).json({ success: false, conflicts });
    }

    // Apply cherry-picked changes
    await db.run('BEGIN TRANSACTION');
    try {
      for (const bin of binsToRestore) {
        await db.run(
          `INSERT OR REPLACE INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          bin.id, bin.qr_id, bin.name, bin.location, bin.image_url, bin.created_at
        );
      }

      for (const item of itemsToRestore) {
        const tagsString = item.search_tags
          ? (typeof item.search_tags === 'string' ? item.search_tags : JSON.stringify(item.search_tags))
          : null;
        await db.run(
          `INSERT OR REPLACE INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id, item.bin_id, item.name, item.description, item.image_url, tagsString, item.visible_text, item.created_at
        );
      }
      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    await saveAuditEntry(db, 'CHERRY_PICK', `Restored ${binsToRestore.length} bin(s) and ${itemsToRestore.length} item(s) by selective cherry-pick`);
    res.json({ success: true, binsCount: binsToRestore.length, itemsCount: itemsToRestore.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error restoring selected changes' });
  }
});

// Serve the built client as a single-page app when present (production/Docker).
// Guarded so dev (Vite on :5173) is unaffected, and the regex keeps API and
// upload routes handled by their own handlers while everything else falls back
// to index.html.
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/(api|uploads)\b).*/i, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Initialize DB and start listening
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  initDb()
    .then(async () => {
      const db = getDb();
      // Run cleanup on startup
      await cleanupQuarantinedImages(db);
      // Schedule cleanup every hour
      setInterval(() => cleanupQuarantinedImages(getDb()), 60 * 60 * 1000);

      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    })
    .catch(err => {
      console.error("Failed to initialize database:", err);
      process.exit(1);
    });
}
