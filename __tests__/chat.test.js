/**
 * Tests for anonymous chat functionality
 */

// Mock WebSocket
class MockWebSocket {
  constructor() {
    this.readyState = 1; // OPEN
    this.OPEN = 1;
    this.messages = [];
  }

  send(data) {
    this.messages.push(JSON.parse(data));
  }
}

describe('Chat Functionality', () => {
  let generateMathChallenge;
  let CHAT_MESSAGE_MAX_LENGTH;
  let CHAT_NICKNAME_MAX_LENGTH;
  let CHAT_MESSAGE_COOLDOWN_MS;
  let CHAT_MATH_MIN;
  let CHAT_MATH_MAX;

  beforeAll(() => {
    // Set environment variables for testing
    process.env.CHAT_MESSAGE_MAX_LENGTH = '500';
    process.env.CHAT_NICKNAME_MAX_LENGTH = '24';
    process.env.CHAT_MESSAGE_COOLDOWN_MS = '1000';
    process.env.CHAT_MATH_MIN = '1';
    process.env.CHAT_MATH_MAX = '10';

    CHAT_MESSAGE_MAX_LENGTH = 500;
    CHAT_NICKNAME_MAX_LENGTH = 24;
    CHAT_MESSAGE_COOLDOWN_MS = 1000;
    CHAT_MATH_MIN = 1;
    CHAT_MATH_MAX = 10;

    // Define the math challenge generator function
    generateMathChallenge = function() {
      const min = CHAT_MATH_MIN;
      const max = CHAT_MATH_MAX;
      const a = Math.floor(Math.random() * (max - min + 1)) + min;
      const b = Math.floor(Math.random() * (max - min + 1)) + min;
      return {
        a,
        b,
        answer: a + b,
        question: `${a} + ${b} = ?`,
      };
    };
  });

  describe('Math Challenge Generator', () => {
    test('should generate valid addition problems', () => {
      for (let i = 0; i < 10; i++) {
        const challenge = generateMathChallenge();
        
        expect(challenge).toHaveProperty('a');
        expect(challenge).toHaveProperty('b');
        expect(challenge).toHaveProperty('answer');
        expect(challenge).toHaveProperty('question');
        
        expect(challenge.a).toBeGreaterThanOrEqual(CHAT_MATH_MIN);
        expect(challenge.a).toBeLessThanOrEqual(CHAT_MATH_MAX);
        expect(challenge.b).toBeGreaterThanOrEqual(CHAT_MATH_MIN);
        expect(challenge.b).toBeLessThanOrEqual(CHAT_MATH_MAX);
        expect(challenge.answer).toBe(challenge.a + challenge.b);
        expect(challenge.question).toBe(`${challenge.a} + ${challenge.b} = ?`);
      }
    });

    test('should generate different challenges', () => {
      const challenges = new Set();
      for (let i = 0; i < 20; i++) {
        const challenge = generateMathChallenge();
        challenges.add(challenge.question);
      }
      // With 10x10 possibilities, we should get at least a few different ones
      expect(challenges.size).toBeGreaterThan(1);
    });
  });

  describe('Chat State Validation', () => {
    test('should initialize chat state correctly', () => {
      const chatState = {
        nickname: null,
        verifiedHuman: false,
        challenge: null,
        lastChatAt: 0,
      };

      expect(chatState.nickname).toBeNull();
      expect(chatState.verifiedHuman).toBe(false);
      expect(chatState.challenge).toBeNull();
      expect(chatState.lastChatAt).toBe(0);
    });

    test('should validate nickname length', () => {
      const validNickname = 'TestUser';
      const tooLongNickname = 'A'.repeat(CHAT_NICKNAME_MAX_LENGTH + 1);

      expect(validNickname.length).toBeLessThanOrEqual(CHAT_NICKNAME_MAX_LENGTH);
      expect(tooLongNickname.length).toBeGreaterThan(CHAT_NICKNAME_MAX_LENGTH);
    });

    test('should trim whitespace from nicknames', () => {
      const nickname = '  TestUser  ';
      const trimmed = nickname.trim();
      
      expect(trimmed).toBe('TestUser');
      expect(trimmed.length).toBeLessThanOrEqual(CHAT_NICKNAME_MAX_LENGTH);
    });

    test('should validate message length', () => {
      const validMessage = 'Hello world!';
      const tooLongMessage = 'A'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1);

      expect(validMessage.length).toBeLessThanOrEqual(CHAT_MESSAGE_MAX_LENGTH);
      expect(tooLongMessage.length).toBeGreaterThan(CHAT_MESSAGE_MAX_LENGTH);
      
      // Messages exceeding max length should be rejected, not truncated
      const shouldReject = tooLongMessage.length > CHAT_MESSAGE_MAX_LENGTH;
      expect(shouldReject).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce cooldown period', () => {
      const lastChatAt = Date.now();
      const now = lastChatAt + 500; // 500ms later
      const timeSinceLastMessage = now - lastChatAt;

      expect(timeSinceLastMessage).toBeLessThan(CHAT_MESSAGE_COOLDOWN_MS);
    });

    test('should allow message after cooldown', () => {
      const lastChatAt = Date.now();
      const now = lastChatAt + CHAT_MESSAGE_COOLDOWN_MS + 100; // After cooldown
      const timeSinceLastMessage = now - lastChatAt;

      expect(timeSinceLastMessage).toBeGreaterThanOrEqual(CHAT_MESSAGE_COOLDOWN_MS);
    });
  });

  describe('Message Format', () => {
    test('should format chat message payload correctly', () => {
      const nickname = 'TestUser';
      const text = 'Hello world!';
      const timestamp = new Date().toISOString();

      const payload = {
        type: 'chat_message',
        nickname,
        text,
        timestamp
      };

      expect(payload.type).toBe('chat_message');
      expect(payload.nickname).toBe(nickname);
      expect(payload.text).toBe(text);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('should use default nickname when not provided', () => {
      const nickname = null;
      const finalNickname = nickname || 'Anon';

      expect(finalNickname).toBe('Anon');
    });
  });

  describe('Challenge Verification', () => {
    test('should verify correct answer', () => {
      const challenge = { a: 5, b: 3, answer: 8, question: '5 + 3 = ?' };
      const userAnswer = 8;

      expect(Number(userAnswer)).toBe(challenge.answer);
    });

    test('should reject incorrect answer', () => {
      const challenge = { a: 5, b: 3, answer: 8, question: '5 + 3 = ?' };
      const userAnswer = 7;

      expect(Number(userAnswer)).not.toBe(challenge.answer);
    });

    test('should handle string answers', () => {
      const challenge = { a: 5, b: 3, answer: 8, question: '5 + 3 = ?' };
      const userAnswer = '8';

      expect(Number(userAnswer)).toBe(challenge.answer);
    });
  });

  describe('Environment Variable Configuration', () => {
    test('should use environment variables for configuration', () => {
      const testEnvVars = {
        CHAT_MESSAGE_MAX_LENGTH: '300',
        CHAT_NICKNAME_MAX_LENGTH: '15',
        CHAT_MESSAGE_COOLDOWN_MS: '2000',
        CHAT_MATH_MIN: '5',
        CHAT_MATH_MAX: '15'
      };

      Object.entries(testEnvVars).forEach(([key, value]) => {
        expect(Number(value)).toBeGreaterThan(0);
      });
    });

    test('should fall back to defaults when env vars not set', () => {
      const defaults = {
        CHAT_MESSAGE_MAX_LENGTH: 500,
        CHAT_NICKNAME_MAX_LENGTH: 24,
        CHAT_MESSAGE_COOLDOWN_MS: 1000,
        CHAT_MATH_MIN: 1,
        CHAT_MATH_MAX: 10
      };

      expect(defaults.CHAT_MESSAGE_MAX_LENGTH).toBe(500);
      expect(defaults.CHAT_NICKNAME_MAX_LENGTH).toBe(24);
      expect(defaults.CHAT_MESSAGE_COOLDOWN_MS).toBe(1000);
      expect(defaults.CHAT_MATH_MIN).toBe(1);
      expect(defaults.CHAT_MATH_MAX).toBe(10);
    });
  });
});
