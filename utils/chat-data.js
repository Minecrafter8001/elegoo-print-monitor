/**
 * Chat Data Manager - Handles persistent storage for chat features
 * Manages reserved nicknames, verified IPs, and blocked words
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

// File paths
const RESERVED_NICKNAMES_FILE = path.join(DATA_DIR, 'reserved-nicknames.json');
const VERIFIED_IPS_FILE = path.join(DATA_DIR, 'verified-ips.json');
const BLOCKED_WORDS_FILE = path.join(DATA_DIR, 'blocked-words.json');

// In-memory cache
let reservedNicknames = {};
let verifiedIPs = {};
let blockedWords = [];

/**
 * Initialize data files if they don't exist (copy from examples)
 */
function initializeDataFiles() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initialize reserved nicknames
  if (!fs.existsSync(RESERVED_NICKNAMES_FILE)) {
    const exampleFile = path.join(DATA_DIR, 'reserved-nicknames.example.json');
    if (fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, RESERVED_NICKNAMES_FILE);
    } else {
      fs.writeFileSync(RESERVED_NICKNAMES_FILE, '{}');
    }
  }

  // Initialize verified IPs
  if (!fs.existsSync(VERIFIED_IPS_FILE)) {
    const exampleFile = path.join(DATA_DIR, 'verified-ips.example.json');
    if (fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, VERIFIED_IPS_FILE);
    } else {
      fs.writeFileSync(VERIFIED_IPS_FILE, '{}');
    }
  }

  // Initialize blocked words
  if (!fs.existsSync(BLOCKED_WORDS_FILE)) {
    const exampleFile = path.join(DATA_DIR, 'blocked-words.example.json');
    if (fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, BLOCKED_WORDS_FILE);
    } else {
      fs.writeFileSync(BLOCKED_WORDS_FILE, '[]');
    }
  }
}

/**
 * Load all data from JSON files into memory
 */
function loadData() {
  try {
    initializeDataFiles();

    // Load reserved nicknames
    const reservedData = fs.readFileSync(RESERVED_NICKNAMES_FILE, 'utf8');
    reservedNicknames = JSON.parse(reservedData);

    // Load verified IPs
    const verifiedIPsData = fs.readFileSync(VERIFIED_IPS_FILE, 'utf8');
    verifiedIPs = JSON.parse(verifiedIPsData);

    // Load blocked words
    const blockedWordsData = fs.readFileSync(BLOCKED_WORDS_FILE, 'utf8');
    blockedWords = JSON.parse(blockedWordsData).map(word => word.toLowerCase());

    console.log(`[ChatData] Loaded ${Object.keys(reservedNicknames).length} reserved nicknames`);
    console.log(`[ChatData] Loaded ${Object.keys(verifiedIPs).length} verified IPs`);
    console.log(`[ChatData] Loaded ${blockedWords.length} blocked words`);
  } catch (err) {
    console.error('[ChatData] Error loading data:', err.message);
  }
}

/**
 * Save verified IPs to file
 */
function saveVerifiedIPs() {
  try {
    fs.writeFileSync(VERIFIED_IPS_FILE, JSON.stringify(verifiedIPs, null, 2));
  } catch (err) {
    console.error('[ChatData] Error saving verified IPs:', err.message);
  }
}

/**
 * Hash a password using SHA-256
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Check if a nickname is reserved
 */
function isReservedNickname(nickname) {
  return reservedNicknames.hasOwnProperty(nickname);
}

/**
 * Verify a password for a reserved nickname
 */
function verifyPassword(nickname, password) {
  const reserved = reservedNicknames[nickname];
  if (!reserved) return false;
  
  const passwordHash = hashPassword(password);
  return passwordHash === reserved.passwordHash;
}

/**
 * Check if an IP is verified for a specific nickname
 */
function isIPVerified(ip, nickname) {
  const verified = verifiedIPs[ip];
  return verified && verified.nickname === nickname;
}

/**
 * Add or update verified IP
 */
function addVerifiedIP(ip, nickname) {
  verifiedIPs[ip] = {
    nickname,
    verifiedAt: verifiedIPs[ip]?.verifiedAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
  saveVerifiedIPs();
}

/**
 * Update last seen time for verified IP
 */
function updateIPLastSeen(ip) {
  if (verifiedIPs[ip]) {
    verifiedIPs[ip].lastSeenAt = new Date().toISOString();
    saveVerifiedIPs();
  }
}

/**
 * Check if text contains blocked words
 * Returns the first blocked word found, or null if none
 */
function containsBlockedWord(text) {
  const lowerText = text.toLowerCase();
  for (const word of blockedWords) {
    // Check for whole word matches (with word boundaries)
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerText)) {
      return word;
    }
  }
  return null;
}

/**
 * Get list of all reserved nicknames
 */
function getReservedNicknames() {
  return Object.keys(reservedNicknames);
}

/**
 * Get verified IP info
 */
function getVerifiedIPInfo(ip) {
  return verifiedIPs[ip] || null;
}

module.exports = {
  loadData,
  isReservedNickname,
  verifyPassword,
  isIPVerified,
  addVerifiedIP,
  updateIPLastSeen,
  containsBlockedWord,
  getReservedNicknames,
  getVerifiedIPInfo,
  hashPassword
};
