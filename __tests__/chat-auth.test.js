/**
 * Tests for reserved nicknames, IP tracking, and blocked words
 */

const ChatData = require('utils/chat-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RESERVED_FILE = path.join(DATA_DIR, 'reserved-nicknames.json');
const BLOCKED_FILE = path.join(DATA_DIR, 'blocked-words.json');

let originalReserved = null;
let originalBlocked = null;

beforeAll(() => {
  originalReserved = fs.readFileSync(RESERVED_FILE, 'utf8');
  originalBlocked = fs.readFileSync(BLOCKED_FILE, 'utf8');

  const reserved = {
    Admin: {
      passwordHash: ChatData.hashPassword('password')
    }
  };

  fs.writeFileSync(RESERVED_FILE, JSON.stringify(reserved, null, 2));
  fs.writeFileSync(BLOCKED_FILE, JSON.stringify(['spam', 'bot'], null, 2));

  ChatData.loadData();
});

afterAll(() => {
  if (originalReserved !== null) {
    fs.writeFileSync(RESERVED_FILE, originalReserved);
  }

  if (originalBlocked !== null) {
    fs.writeFileSync(BLOCKED_FILE, originalBlocked);
  }

  ChatData.loadData();
});

describe('Chat Data Management', () => {
  describe('Password Hashing', () => {
    test('should hash passwords consistently', () => {
      const password = 'testpassword';
      const hash1 = ChatData.hashPassword(password);
      const hash2 = ChatData.hashPassword(password);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string length
    });

    test('should produce different hashes for different passwords', () => {
      const hash1 = ChatData.hashPassword('password1');
      const hash2 = ChatData.hashPassword('password2');
      
      expect(hash1).not.toBe(hash2);
    });

    test('should match expected SHA-256 hash', () => {
      const password = 'password';
      const expectedHash = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
      const actualHash = ChatData.hashPassword(password);
      
      expect(actualHash).toBe(expectedHash);
    });
  });

  describe('Reserved Nicknames', () => {

    test('should identify reserved nicknames', () => {
      // "Admin" should be in the example reserved nicknames
      expect(ChatData.isReservedNickname('Admin')).toBe(true);
    });

    test('should identify non-reserved nicknames', () => {
      expect(ChatData.isReservedNickname('RegularUser')).toBe(false);
      expect(ChatData.isReservedNickname('TestUser123')).toBe(false);
    });

    test('should verify correct password for reserved nickname', () => {
      // "Admin" with password "password" in example file
      expect(ChatData.verifyPassword('Admin', 'password')).toBe(true);
    });

    test('should reject incorrect password', () => {
      expect(ChatData.verifyPassword('Admin', 'wrongpassword')).toBe(false);
    });

    test('should return false for non-reserved nickname', () => {
      expect(ChatData.verifyPassword('RegularUser', 'anypassword')).toBe(false);
    });
  });

  describe('IP Verification Tracking', () => {
    const testIP = '192.168.1.100';
    const testNickname = 'TestUser';

    test('should check IP verification status', () => {
      // Initially, a random IP should not be verified
      const randomIP = '10.0.0.1';
      expect(ChatData.isIPVerified(randomIP, 'SomeNickname')).toBe(false);
    });

    test('should add verified IP', () => {
      ChatData.addVerifiedIP(testIP, testNickname);
      expect(ChatData.isIPVerified(testIP, testNickname)).toBe(true);
    });

    test('should not verify IP for different nickname', () => {
      ChatData.addVerifiedIP(testIP, testNickname);
      expect(ChatData.isIPVerified(testIP, 'DifferentNickname')).toBe(false);
    });

    test('should get verified IP info', () => {
      ChatData.addVerifiedIP(testIP, testNickname);
      const info = ChatData.getVerifiedIPInfo(testIP);
      
      expect(info).toBeTruthy();
      expect(info.nickname).toBe(testNickname);
      expect(info.verifiedAt).toBeTruthy();
      expect(info.lastSeenAt).toBeTruthy();
    });

    test('should return null for non-verified IP', () => {
      const info = ChatData.getVerifiedIPInfo('1.2.3.4');
      expect(info).toBeNull();
    });
  });

  describe('Blocked Words Filtering', () => {

    test('should detect blocked words in text', () => {
      // Assuming "spam" is in the blocked words list
      const result = ChatData.containsBlockedWord('This is spam message');
      expect(result).toBe('spam');
    });

    test('should detect blocked words case-insensitively', () => {
      const result = ChatData.containsBlockedWord('This is SPAM');
      expect(result).toBe('spam');
    });

    test('should detect blocked words with word boundaries', () => {
      const result = ChatData.containsBlockedWord('bot message');
      expect(result).toBe('bot');
    });

    test('should not detect blocked words as substrings', () => {
      // "bot" is blocked, but "robot" should not trigger it
      const result = ChatData.containsBlockedWord('robot message');
      expect(result).toBeNull();
    });

    test('should return null for clean text', () => {
      const result = ChatData.containsBlockedWord('This is a clean message');
      expect(result).toBeNull();
    });

    test('should detect multiple blocked words (returns first)', () => {
      const result = ChatData.containsBlockedWord('spam and bot');
      expect(result).toBeTruthy();
      expect(['spam', 'bot']).toContain(result);
    });
  });

  describe('Nickname Validation Flow', () => {
    test('should allow reserved nicknames even if they contain blocked words', () => {
      // This tests the logic order: reserved nicknames should be checked first
      // If "Admin" is reserved and "admin" is blocked, "Admin" should still work
      const isReserved = ChatData.isReservedNickname('Admin');
      expect(isReserved).toBe(true);
    });

    test('should block regular nicknames with blocked words', () => {
      // Word boundaries mean "spam" must be a whole word, not part of "spam123"
      const hasBlockedWord = ChatData.containsBlockedWord('spam user');
      expect(hasBlockedWord).toBe('spam');
    });
  });

  describe('Message Validation', () => {
    test('should allow messages without blocked words', () => {
      const testMessages = [
        'Hello everyone!',
        'How is the print going?',
        'Nice work on this project!'
      ];

      testMessages.forEach(msg => {
        expect(ChatData.containsBlockedWord(msg)).toBeNull();
      });
    });

    test('should block messages with blocked words', () => {
      const result = ChatData.containsBlockedWord('This is a spam message');
      expect(result).toBe('spam');
    });

    test('should handle empty messages', () => {
      expect(ChatData.containsBlockedWord('')).toBeNull();
    });

    test('should handle special characters', () => {
      expect(ChatData.containsBlockedWord('Hello! How are you?')).toBeNull();
    });
  });
});
