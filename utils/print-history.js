const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../data/print-history.json');
const MAX_HISTORY_ENTRIES = 100; // Keep last 100 prints

/**
 * Print History Storage
 * 
 * This module provides an abstraction layer for print history storage.
 * Currently implemented with JSON file storage, but designed to be easily
 * swapped for a database backend (MongoDB, PostgreSQL, etc.) in the future.
 * 
 * To migrate to a database:
 * 1. Replace the StorageAdapter class below with a database-specific implementation
 * 2. Implement the same interface methods (load, save, findById, etc.)
 * 3. Update the initialization in the module exports
 * 4. All business logic in this module will continue to work unchanged
 */

/**
 * Abstract Storage Adapter Interface
 * Future database implementations should follow this interface
 */
class StorageAdapter {
  async load() { throw new Error('Not implemented'); }
  async save(data) { throw new Error('Not implemented'); }
  async findById(id) { throw new Error('Not implemented'); }
  async findAll(options) { throw new Error('Not implemented'); }
  async insert(record) { throw new Error('Not implemented'); }
  async update(id, changes) { throw new Error('Not implemented'); }
}

/**
 * JSON File Storage Adapter
 * Simple file-based storage using JSON
 */
class JSONStorageAdapter extends StorageAdapter {
  constructor(filePath, maxEntries) {
    super();
    this.filePath = filePath;
    this.maxEntries = maxEntries;
    this.cache = [];
  }

  async load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        this.cache = JSON.parse(data);
        console.log(`[PrintHistory] Loaded ${this.cache.length} print(s) from history`);
      } else {
        this.cache = [];
        console.log('[PrintHistory] No history file found, starting fresh');
      }
      return this.cache;
    } catch (err) {
      console.error('[PrintHistory] Failed to load history:', err.message);
      this.cache = [];
      return this.cache;
    }
  }

  async save(data) {
    try {
      this.cache = data;
      // Keep only the most recent entries
      if (this.cache.length > this.maxEntries) {
        this.cache = this.cache.slice(-this.maxEntries);
      }
      
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      console.error('[PrintHistory] Failed to save history:', err.message);
    }
  }

  async findById(id) {
    return this.cache.find(p => p.id === id) || null;
  }

  async findAll(options = {}) {
    let results = [...this.cache];
    
    if (options.reverse) {
      results = results.reverse();
    }
    
    if (options.limit) {
      results = results.slice(0, options.limit);
    }
    
    return results;
  }

  async insert(record) {
    this.cache.push(record);
    await this.save(this.cache);
    return record;
  }

  async update(id, changes) {
    const index = this.cache.findIndex(p => p.id === id);
    if (index === -1) return null;
    
    this.cache[index] = { ...this.cache[index], ...changes };
    await this.save(this.cache);
    return this.cache[index];
  }
}

// Initialize storage adapter (swap this for database adapter in the future)
const storage = new JSONStorageAdapter(HISTORY_FILE, MAX_HISTORY_ENTRIES);

let currentPrint = null;

/**
 * Start tracking a new print
 * @param {string} filename - Name of the file being printed
 * @returns {object} The new print object
 */
async function startPrint(filename) {
  if (!filename) return null;
  
  // If there's an existing current print with the same filename, don't create a new one
  if (currentPrint && currentPrint.filename === filename) {
    return currentPrint;
  }
  
  // Save any existing current print to history before starting new one
  if (currentPrint) {
    await completePrint();
  }
  
  currentPrint = {
    id: `print_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    filename: filename,
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'printing',
    comments: []
  };
  
  console.log(`[PrintHistory] Started tracking print: ${filename} (${currentPrint.id})`);
  return currentPrint;
}

/**
 * Complete the current print and add it to history
 */
async function completePrint() {
  if (!currentPrint) return;
  
  currentPrint.endTime = new Date().toISOString();
  currentPrint.status = 'completed';
  
  await storage.insert(currentPrint);
  console.log(`[PrintHistory] Completed print: ${currentPrint.filename}`);
  
  currentPrint = null;
}

/**
 * Cancel the current print
 */
async function cancelPrint() {
  if (!currentPrint) return;
  
  currentPrint.endTime = new Date().toISOString();
  currentPrint.status = 'cancelled';
  
  await storage.insert(currentPrint);
  console.log(`[PrintHistory] Cancelled print: ${currentPrint.filename}`);
  
  currentPrint = null;
}

/**
 * Get the current print being tracked
 * @returns {object|null} Current print object or null
 */
function getCurrentPrint() {
  return currentPrint;
}

/**
 * Get all print history
 * @param {number} limit - Optional limit on number of entries to return
 * @returns {Promise<array>} Array of print history entries
 */
async function getHistory(limit = null) {
  return await storage.findAll({ reverse: true, limit });
}

/**
 * Get a specific print by ID
 * @param {string} printId - The print ID to look up
 * @returns {Promise<object|null>} The print object or null if not found
 */
async function getPrintById(printId) {
  // Check current print first
  if (currentPrint && currentPrint.id === printId) {
    return currentPrint;
  }
  
  // Check storage
  return await storage.findById(printId);
}

/**
 * Add a comment to a print
 * @param {string} printId - The print ID
 * @param {string} nickname - User's nickname (can be empty for anonymous)
 * @param {string} text - Comment text
 * @returns {Promise<object|null>} The comment object or null if print not found
 */
async function addComment(printId, nickname, text) {
  // Check current print first
  let print;
  const isCurrentPrint = currentPrint && currentPrint.id === printId;
  
  if (isCurrentPrint) {
    print = currentPrint;
  } else {
    print = await storage.findById(printId);
  }
  
  if (!print) return null;
  
  const comment = {
    id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    nickname: nickname || 'Anon',
    text: text,
    timestamp: new Date().toISOString()
  };
  
  print.comments.push(comment);
  
  // Save to storage if it's in history (not current print)
  if (!isCurrentPrint) {
    await storage.update(printId, { comments: print.comments });
  }
  
  return comment;
}

/**
 * Get comments for a specific print
 * @param {string} printId - The print ID
 * @returns {Promise<array>} Array of comments
 */
async function getComments(printId) {
  const print = await getPrintById(printId);
  return print ? print.comments : [];
}

/**
 * Clear all history (for testing/admin purposes)
 */
async function clearHistory() {
  await storage.save([]);
  currentPrint = null;
  console.log('[PrintHistory] History cleared');
}

// Load history on module initialization
storage.load();

module.exports = {
  startPrint,
  completePrint,
  cancelPrint,
  getCurrentPrint,
  getHistory,
  getPrintById,
  addComment,
  getComments,
  clearHistory
};
