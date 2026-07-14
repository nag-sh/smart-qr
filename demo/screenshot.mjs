// Seed a demo dataset into the offline (IndexedDB) app and capture mobile screenshots.
import { chromium } from 'playwright';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, 'demo-images');
const OUT_DIR = path.join(__dirname, 'screenshots');
const BASE = 'http://127.0.0.1:5173/';

// Fixed IDs so we can deep-link to specific screens.
const BIN = {
  garage: randomUUID(),
  kitchen: randomUUID(),
  office: randomUUID(),
  closet: randomUUID(),
};
const ITEM = {
  drill: randomUUID(),
  wrench: randomUUID(),
  worklight: randomUUID(),
  mug: randomUUID(),
  skillet: randomUUID(),
  spice: randomUUID(),
  keyboard: randomUUID(),
  notebook: randomUUID(),
  hub: randomUUID(),
  shoes: randomUUID(),
  backpack: randomUUID(),
  lamp: randomUUID(),
};

const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();

// Demo dataset definition (image key -> which file)
const BINS = [
  { id: BIN.garage,  qr_id: 'BIN-GARAGE-001',  name: 'Garage Tools',    location: 'Garage',  img: 'bin-garage',  created_at: iso(600) },
  { id: BIN.kitchen, qr_id: 'BIN-KITCHEN-001', name: 'Kitchenware',     location: 'Kitchen', img: 'bin-kitchen', created_at: iso(540) },
  { id: BIN.office,  qr_id: 'BIN-OFFICE-001',  name: 'Office Supplies', location: 'Office',  img: 'bin-office',  created_at: iso(480) },
  { id: BIN.closet,  qr_id: 'BIN-CLOSET-001',  name: 'Closet & Gear',   location: 'Bedroom', img: 'bin-closet',  created_at: iso(420) },
];

const ITEMS = [
  { id: ITEM.drill,     bin_id: BIN.garage,  img: 'item-drill',     name: 'Cordless Drill',     description: '18V brushless driver with two batteries and a fast charger.', tags: ['power tool', 'battery'],            visible_text: 'MAKITA XDT', created_at: iso(560) },
  { id: ITEM.wrench,    bin_id: BIN.garage,  img: 'item-wrench',    name: 'Adjustable Wrench',  description: '10-inch crescent wrench, chrome vanadium steel.',               tags: ['hand tool'],                 visible_text: '8-10in',     created_at: iso(540) },
  { id: ITEM.worklight, bin_id: BIN.garage,  img: 'item-worklight', name: 'LED Work Light',    description: 'Rechargeable 1000-lumen site light with magnetic base.',         tags: ['lighting'],                  visible_text: '1000LM',     created_at: iso(520) },
  { id: ITEM.mug,       bin_id: BIN.kitchen, img: 'item-mug',       name: 'Ceramic Mug',       description: 'Hand-glazed 12oz coffee mug, microwave safe.',                  tags: ['drinkware'],                visible_text: '12oz',       created_at: iso(500) },
  { id: ITEM.skillet,   bin_id: BIN.kitchen, img: 'item-skillet',   name: 'Cast Iron Skillet', description: '10-inch pre-seasoned skillet, oven safe to 500F.',              tags: ['cookware'],                 visible_text: '10in',       created_at: iso(480) },
  { id: ITEM.spice,     bin_id: BIN.kitchen, img: 'item-spice',     name: 'Spice Jar',         description: 'Airtight glass jar with labeled lid, half-full.',               tags: ['pantry'],                   visible_text: 'CUMIN',      created_at: iso(460) },
  { id: ITEM.keyboard,  bin_id: BIN.office,  img: 'item-keyboard',  name: 'Mechanical Keyboard', description: 'Hot-swap 75% board with linear switches and PBT keycaps.',      tags: ['computer', 'peripheral'],   visible_text: '75%',        created_at: iso(440) },
  { id: ITEM.notebook,  bin_id: BIN.office,  img: 'item-notebook',  name: 'Notebook',          description: 'Dot-grid A5 notebook, about 60% filled.',                       tags: ['stationery'],               visible_text: 'A5',         created_at: iso(420) },
  { id: ITEM.hub,       bin_id: BIN.office,  img: 'item-hub',       name: 'USB-C Hub',         description: '7-in-1 hub: HDMI, SD, 2x USB-A, 2x USB-C, 100W PD.',            tags: ['computer', 'peripheral'],   visible_text: '7-IN-1',     created_at: iso(400) },
  { id: ITEM.shoes,     bin_id: BIN.closet,  img: 'item-shoes',     name: 'Running Shoes',     description: 'Lightweight road shoes, size 10, ~200 miles logged.',            tags: ['footwear'],                 visible_text: 'US 10',      created_at: iso(380) },
  { id: ITEM.backpack,  bin_id: BIN.closet,  img: 'item-backpack',  name: 'Canvas Backpack',   description: '22L everyday pack with laptop sleeve and water-bottle pocket.', tags: ['bag'],                      visible_text: '22L',        created_at: iso(360) },
  { id: ITEM.lamp,      bin_id: BIN.closet,  img: 'item-lamp',      name: 'Desk Lamp',         description: 'Dimmable LED clamp lamp with adjustable color temperature.',     tags: ['lighting'],                 visible_text: 'LED',        created_at: iso(340) },
];

async function loadImages() {
  const files = await readdir(IMG_DIR);
  const map = {};
  for (const f of files) {
    const key = f.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    const buf = await readFile(path.join(IMG_DIR, f));
    const mime = f.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg';
    map[key] = `data:${mime};base64,${buf.toString('base64')}`;
  }
  return map;
}

const seedInPage = async (page, images, refs) => {
  // Phase 1: store image blobs, return img_ refs keyed by image key.
  const storeImages = await page.evaluate(async (images) => {
    const openDB = () => new Promise((res, rej) => {
      const r = indexedDB.open('smart-qr-images', 1);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
      r.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains('images')) db.createObjectStore('images'); };
    });
    const dataURLToBlob = (d) => {
      const [h, b64] = d.split(',');
      const mime = h.match(/:(.*?);/)[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    };
    const db = await openDB();
    const out = {};
    for (const [key, d] of Object.entries(images)) {
      const ref = 'img_' + crypto.randomUUID();
      await new Promise((res, rej) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(dataURLToBlob(d), ref);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      out[key] = ref;
    }
    return out;
  }, images);

  // Phase 2: build + store bins/items using refs.
  await page.evaluate(async ({ storeImages, BINS, ITEMS }) => {
    const openTables = () => new Promise((res, rej) => {
      const r = indexedDB.open('smart-qr-data', 1);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
      r.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables'); };
    });
    const setTable = (db, name, val) => new Promise((res, rej) => {
      const tx = db.transaction('tables', 'readwrite');
      tx.objectStore('tables').put(val, name);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    const imgOf = (k) => storeImages[k];

    const bins = BINS.map((b) => ({
      id: b.id, qr_id: b.qr_id, name: b.name, location: b.location,
      image_url: imgOf(b.img), created_at: b.created_at,
    }));
    const items = ITEMS.map((it) => ({
      id: it.id, bin_id: it.bin_id, name: it.name, description: it.description || '',
      image_url: imgOf(it.img), search_tags: it.tags || [], visible_text: it.visible_text || '',
      created_at: it.created_at,
    }));

    const db = await openTables();
    await setTable(db, 'local_bins', bins);
    await setTable(db, 'local_items', items);
  }, { storeImages: storeImages, BINS, ITEMS });

  return storeImages;
};

const shot = async (page, name, opts = {}) => {
  const p = path.join(OUT_DIR, name);
  await page.screenshot({ path: p, fullPage: !!opts.fullPage });
  console.log('saved', p);
};

// Assert expected text is visible, and that local images actually decoded.
const verify = async (page, label, texts) => {
  let ok = true;
  for (const t of texts) {
    const found = await page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
    console.log(`  [${found ? 'OK ' : 'MISS'}] ${label}: "${t}"`);
    if (!found) ok = false;
  }
  const imgStats = await page.evaluate(() => {
    const imgs = Array.from(document.images);
    const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
    return { total: imgs.length, loaded };
  }).catch(() => ({ total: 0, loaded: 0 }));
  console.log(`  images: ${imgStats.loaded}/${imgStats.total} loaded`);
  return ok;
};

async function main() {
  await import('node:fs/promises').then((m) => m.mkdir(OUT_DIR, { recursive: true }));
  const images = await loadImages();

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    permissions: ['camera'],
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });

  // Provide a synthetic camera stream so the Scanner screen renders a clean
  // feed in headless Chromium (app code is untouched).
  await page.addInitScript(() => {
    const patch = () => {
      if (!navigator.mediaDevices) navigator.mediaDevices = {};
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 720; canvas.height = 960;
        const ctx = canvas.getContext('2d');
        let t = 0;
        const draw = () => {
          const g = ctx.createLinearGradient(0, 0, 720, 960);
          g.addColorStop(0, `hsl(${t % 360},55%,38%)`);
          g.addColorStop(1, `hsl(${(t + 140) % 360},55%,28%)`);
          ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, 720, 960);
          ctx.fillStyle = g; ctx.fillRect(40, 60, 640, 760);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 4;
          ctx.strokeRect(160, 300, 400, 360);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('Smart QR Inventory', 360, 250);
          ctx.font = '20px sans-serif';
          ctx.fillText('Point the camera at a bin or item label', 360, 740);
          t += 1.5;
        };
        draw();
        const id = setInterval(draw, 70);
        const stream = canvas.captureStream(15);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(id));
        return stream;
      };
    };
    patch();
  });

  // Load app once so IndexedDB exists, then seed.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await seedInPage(page, images);
  // Reload so the app reads seeded data.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('text=Search', { timeout: 10000 });
  await page.waitForTimeout(600);

  // 1. Home (inventory list)
  await verify(page, 'home', ['Garage Tools', 'Kitchenware', 'Cordless Drill', 'Running Shoes']);
  await shot(page, '01-home.png', { fullPage: false });

  // 2. Search filtered by Kitchen location (deep link)
  await page.goto(BASE + '?filterLocation=' + encodeURIComponent('Kitchen'), { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await verify(page, 'search-filter', ['Kitchen', 'Ceramic Mug', 'Cast Iron Skillet']);
  await shot(page, '02-search-filter.png', { fullPage: false });

  // 3. Bin details (Garage)
  await page.goto(BASE + '?modal=bin-details&binId=' + BIN.garage, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await verify(page, 'bin-details', ['Garage Tools', 'Cordless Drill', 'LED Work Light']);
  await shot(page, '03-bin-details.png', { fullPage: false });

  // 4. Item details (Drill)
  await page.goto(BASE + '?modal=item-details&itemId=' + ITEM.drill, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await verify(page, 'item-details', ['Cordless Drill', '18V brushless', 'power tool']);
  await shot(page, '04-item-details.png', { fullPage: false });

  // 5. Scanner (fake camera stream)
  await page.goto(BASE + '?modal=scanner', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await verify(page, 'scanner', ['Scan']);
  await shot(page, '05-scanner.png', { fullPage: false });

  // 6. Settings
  await page.goto(BASE + '?modal=settings', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await verify(page, 'settings', ['Settings', 'Storage']);
  await shot(page, '06-settings.png', { fullPage: false });

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
