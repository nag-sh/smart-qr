import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Writable } from 'stream';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import unzipper from 'unzipper';
import { initDb, getDb, closeDb } from '../db.js';
import { exportBackup, importBackupZipFile } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

function createMockResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      callback();
    }
  });
  res.setHeader = () => {};
  res.headersSent = false;
  res.getBuffer = () => Buffer.concat(chunks);
  return res;
}

async function extractZipToDir(zipPath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  await new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

test('backup zip round-trip preserves images as files under images/', async () => {
  const db = await initDb();
  await db.run('DELETE FROM items');
  await db.run('DELETE FROM bins');

  const imageBuffer = Buffer.from('fake-image-data-for-round-trip', 'utf8');
  const imageFilename = `test-backup-${uuidv4()}.jpg`;
  const imagePath = path.join(uploadsDir, imageFilename);
  fs.writeFileSync(imagePath, imageBuffer);

  const binId = uuidv4();
  const itemId = uuidv4();
  const createdAt = new Date().toISOString();
  const importedImageFiles = [];
  let zipPath = null;

  try {
    await db.run(
      `INSERT INTO bins (id, qr_id, name, location, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      binId, `qr-${binId.slice(0, 8)}`, 'Test Bin', 'Garage Shelf', `/uploads/${imageFilename}`, createdAt
    );
    await db.run(
      `INSERT INTO items (id, bin_id, name, description, image_url, search_tags, visible_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      itemId, binId, 'Test Item', 'A test item', `/uploads/${imageFilename}`, JSON.stringify(['test']), 'VISIBLE', createdAt
    );

    const res = createMockResponse();
    await exportBackup(res, true);

    const zipBuffer = res.getBuffer();
    zipPath = path.join(os.tmpdir(), `test-backup-${uuidv4()}.zip`);
    fs.writeFileSync(zipPath, zipBuffer);

    const extractDir = path.join(os.tmpdir(), `test-extract-${uuidv4()}`);
    try {
      await extractZipToDir(zipPath, extractDir);

      const inventoryPath = path.join(extractDir, 'inventory.json');
      assert(fs.existsSync(inventoryPath), 'inventory.json should exist in the zip');
      const data = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

      assert.equal(data.owner, 'dion');
      assert.equal(data.image_layout, 'images/<location>/<bin>/<item>.*');
      assert.equal(data.bins.length, 1);
      assert.equal(data.items.length, 1);

      const exportedBin = data.bins[0];
      const exportedItem = data.items[0];

      assert.ok(exportedBin.image_url && exportedBin.image_url.startsWith('images/'), `bin image_url should be under images/ but got ${exportedBin.image_url}`);
      assert.ok(exportedItem.image_url && exportedItem.image_url.startsWith('images/'), `item image_url should be under images/ but got ${exportedItem.image_url}`);
      assert.ok(!exportedBin.image_url.startsWith('/uploads/'), 'bin image_url should not be a server path');
      assert.ok(!exportedItem.image_url.startsWith('data:'), 'item image_url should not be base64');

      const binImagePath = path.join(extractDir, exportedBin.image_url.replace(/\//g, path.sep));
      const itemImagePath = path.join(extractDir, exportedItem.image_url.replace(/\//g, path.sep));

      assert(fs.existsSync(binImagePath), `bin image file should exist in zip at ${exportedBin.image_url}`);
      assert(fs.existsSync(itemImagePath), `item image file should exist in zip at ${exportedItem.image_url}`);
      assert.deepEqual(fs.readFileSync(binImagePath), imageBuffer);
      assert.deepEqual(fs.readFileSync(itemImagePath), imageBuffer);
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    await db.run('DELETE FROM items');
    await db.run('DELETE FROM bins');

    await importBackupZipFile(zipPath);

    const importedBin = await db.get('SELECT * FROM bins WHERE id = ?', binId);
    const importedItem = await db.get('SELECT * FROM items WHERE id = ?', itemId);

    assert.ok(importedBin, 'imported bin should exist');
    assert.ok(importedItem, 'imported item should exist');

    assert.ok(importedBin.image_url && importedBin.image_url.startsWith('/uploads/'), `imported bin image_url should be /uploads/... but got ${importedBin.image_url}`);
    assert.ok(importedItem.image_url && importedItem.image_url.startsWith('/uploads/'), `imported item image_url should be /uploads/... but got ${importedItem.image_url}`);

    importedImageFiles.push(path.basename(importedBin.image_url));
    importedImageFiles.push(path.basename(importedItem.image_url));

    for (const filename of importedImageFiles) {
      const filePath = path.join(uploadsDir, filename);
      assert(fs.existsSync(filePath), `imported image file should exist on disk at ${filename}`);
      assert.deepEqual(fs.readFileSync(filePath), imageBuffer);
    }
  } finally {
    await db.run('DELETE FROM items');
    await db.run('DELETE FROM bins');
    try { fs.unlinkSync(imagePath); } catch (_) {}
    for (const filename of importedImageFiles) {
      try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch (_) {}
    }
    if (zipPath) {
      try { fs.unlinkSync(zipPath); } catch (_) {}
    }
    await closeDb();
  }
});
