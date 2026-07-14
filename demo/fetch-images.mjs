// Fetch public-domain (or freely licensed) demo images from Wikimedia Commons.
// Saves originals + a manifest with attribution metadata for the README.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'demo-images');
const MANIFEST = path.join(__dirname, 'demo-manifest.json');

// key -> Wikimedia search query
const QUERIES = {
  'bin-garage': 'red metal tool box',
  'bin-kitchen': 'wooden storage crate',
  'bin-office': 'cardboard file box',
  'bin-closet': 'wicker storage basket',
  'item-drill': 'cordless drill',
  'item-wrench': 'adjustable wrench',
  'item-worklight': 'LED work light',
  'item-mug': 'ceramic coffee mug',
  'item-skillet': 'cast iron skillet',
  'item-spice': 'spice jar',
  'item-keyboard': 'mechanical keyboard',
  'item-notebook': 'notebook blank',
  'item-hub': 'USB-C hub',
  'item-shoes': 'running shoes',
  'item-backpack': 'canvas backpack',
  'item-lamp': 'desk lamp',
};

const UA = 'SmartQR-Demo-Screenshot-Script/1.0 (https://github.com/nag-sh/smart-qr)';

async function searchImage(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '900',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const json = await res.json();
  const pages = json.query?.pages || {};
  for (const p of Object.values(pages)) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const mime = ii.mime || '';
    if (!mime.startsWith('image/')) continue;
    if (mime === 'image/svg+xml') continue; // avoid svg
    const thumb = ii.thumburl || ii.url;
    const meta = ii.extmetadata || {};
    const license = meta.LicenseShortName?.value || 'Unknown';
    const artistRaw = meta.Artist?.value || '';
    const artist = artistRaw.replace(/<[^>]+>/g, '').trim().slice(0, 120);
    const descUrl = p.canonicalurl || ii.descriptionurl || '';
    return { thumb, license, artist, descUrl, mime };
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (String(e.message).includes('429')) await sleep(1500 * (i + 1));
      else await sleep(400);
    }
  }
  throw lastErr;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // Resume: keep existing manifest entries so we don't re-download everything.
  let manifest = {};
  try { manifest = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch {}
  for (const [key, query] of Object.entries(QUERIES)) {
    if (manifest[key]) { console.log(`skip ${key} (already have)`); continue; }
    try {
      const found = await withRetry(() => searchImage(query));
      if (!found) { console.error(`No image for ${key} (${query})`); continue; }
      const ext = found.mime === 'image/png' ? 'png' : 'jpg';
      const dest = path.join(OUT_DIR, `${key}.${ext}`);
      const size = await download(found.thumb, dest);
      manifest[key] = {
        file: `${key}.${ext}`,
        query,
        license: found.license,
        artist: found.artist,
        source: found.descUrl,
        bytes: size,
      };
      console.log(`OK  ${key.padEnd(16)} ${found.license.padEnd(10)} ${(size/1024|0)}KB`);
    } catch (e) {
      console.error(`ERR ${key}: ${e.message}`);
    }
    await sleep(500);
  }
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved manifest -> ${MANIFEST}`);
  console.log(`Images: ${Object.keys(manifest).length}/${Object.keys(QUERIES).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
