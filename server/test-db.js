import { initDb, getDb } from './db.js';
import { v4 as uuidv4 } from 'uuid';

async function runTests() {
  try {
    console.log("Verifying Database Schema...");
    const db = await initDb();
    
    // Clean up any test records
    await db.run("DELETE FROM items");
    await db.run("DELETE FROM bins");
    
    // Insert a test bin
    const binId = uuidv4();
    const qrId = 'test-qr-123';
    await db.run(`
      INSERT INTO bins (id, qr_id, name, location)
      VALUES (?, ?, ?, ?)
    `, binId, qrId, 'Camping Gear', 'Garage Shelf A');
    console.log("Inserted test bin:", binId);

    // Insert two test items
    const itemId1 = uuidv4();
    await db.run(`
      INSERT INTO items (id, bin_id, name, description, search_tags, visible_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      itemId1,
      binId,
      'Coleman Sleeping Bag',
      'Blue 0-degree mummy style sleeping bag.',
      JSON.stringify(['camping', 'sleeping bag', 'blue']),
      'COLEMAN OUTDOORS'
    );

    const itemId2 = uuidv4();
    await db.run(`
      INSERT INTO items (id, bin_id, name, description, search_tags, visible_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      itemId2,
      binId,
      'Led Lenser Headlamp',
      'Rechargeable outdoor headlamp.',
      JSON.stringify(['outdoor', 'lighting', 'headlamp']),
      'LED LENSER H7R'
    );
    console.log("Inserted test items:", itemId1, itemId2);

    // Check if automatically synced in FTS
    const ftsCountRow = await db.get("SELECT count(*) as count FROM items_fts");
    const ftsCount = ftsCountRow.count;
    console.log(`FTS Table Row Count: ${ftsCount} (Expected: 2)`);
    if (ftsCount !== 2) throw new Error("FTS triggers failed to sync!");

    // Perform search
    const query = 'Coleman';
    const searchResults = await db.all(`
      SELECT items.*, bins.name as bin_name, bins.location as bin_location
      FROM items_fts
      JOIN items ON items.id = items_fts.item_id
      JOIN bins ON bins.id = items.bin_id
      WHERE items_fts MATCH ?
    `, query);
    
    console.log("Search results for query 'Coleman':", searchResults);
    if (searchResults.length !== 1 || searchResults[0].id !== itemId1) {
      throw new Error("Search verification failed!");
    }

    // Update item and check FTS
    await db.run("UPDATE items SET description = 'Green 0-degree sleeping bag' WHERE id = ?", itemId1);
    const updatedSearch = await db.all("SELECT * FROM items_fts WHERE items_fts MATCH 'Green'");
    console.log("Search results for updated item (query 'Green'):", updatedSearch);
    if (updatedSearch.length !== 1) {
      throw new Error("FTS update trigger failed!");
    }

    // Delete item and check FTS
    await db.run("DELETE FROM items WHERE id = ?", itemId1);
    const deletedSearchRow = await db.get("SELECT count(*) as count FROM items_fts");
    const deletedSearch = deletedSearchRow.count;
    console.log(`FTS Table Row Count after delete: ${deletedSearch} (Expected: 1)`);
    if (deletedSearch !== 1) {
      throw new Error("FTS delete trigger failed!");
    }

    console.log("All DB and FTS5 trigger verifications passed successfully!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runTests();
