# Anonymous Chat System Documentation

## Overview

The print monitor now includes a simple, anonymous chat system that allows users to communicate while monitoring their prints. The implementation emphasizes privacy, simplicity, and backwards compatibility.

## Key Features

### 1. Anonymous Chat with User-Chosen Nicknames
- Users select their own nickname when starting a chat session
- No authentication, login, or user accounts required
- No tracking beyond the current WebSocket session

### 2. No Persistence
- **Important**: Chat messages are NEVER written to disk, database, or any external service
- Messages exist only in server memory during the WebSocket connection lifetime
- When the server restarts, all chat history is lost
- This ensures maximum privacy and minimal data retention

### 3. Anti-Bot Math Challenge
- Before sending their first message, users must solve a simple addition problem
- Example: "7 + 5 = ?"
- Helps prevent automated spam and bot abuse
- Challenge difficulty is configurable via environment variables

### 4. Configurable Limits
All rate limiting and validation rules are controlled via environment variables with sensible defaults:

```bash
# Maximum message length in characters
CHAT_MESSAGE_MAX_LENGTH=500

# Maximum nickname length in characters
CHAT_NICKNAME_MAX_LENGTH=24

# Minimum time between messages in milliseconds (rate limiting)
CHAT_MESSAGE_COOLDOWN_MS=1000

# Minimum number for math challenges
CHAT_MATH_MIN=1

# Maximum number for math challenges
CHAT_MATH_MAX=10
```

### 5. Backwards Compatibility
- The implementation adds new WebSocket message types without modifying existing ones
- Clients running older versions (without chat) continue to work unchanged
- All chat-related messages use new `type` values that older clients ignore

## How to Use (Client Side)

### Starting a Chat Session

1. Enter a nickname in the "Enter nickname" field
2. Click "Start Chat"
3. Solve the math challenge that appears
4. Once verified, you can send and receive messages

### Sending Messages

1. Type your message in the input field (max 500 characters by default)
2. Click "Send" or press Enter
3. Your message appears in the chat window with your nickname and timestamp
4. All connected users see your message in real-time

### Chat Flow

```
┌─────────────────┐
│  Enter Nickname │
│  [Start Chat]   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Math Challenge │
│   "7 + 5 = ?"   │
│  [Verify]       │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Chat Messages  │
│  [Send Message] │
└─────────────────┘
```

## WebSocket Message Protocol

The chat system adds the following message types to the existing WebSocket protocol:

### Client → Server Messages

#### `chat_init`
User sets nickname and requests a math challenge.
```json
{
  "type": "chat_init",
  "nickname": "JohnDoe"
}
```

#### `chat_verify`
User submits answer to the math challenge.
```json
{
  "type": "chat_verify",
  "answer": 12
}
```

#### `chat_message`
User sends a chat message (only allowed after verification).
```json
{
  "type": "chat_message",
  "text": "Hello everyone!"
}
```

### Server → Client Messages

#### `chat_challenge`
Server sends a math challenge to the client.
```json
{
  "type": "chat_challenge",
  "question": "7 + 5 = ?"
}
```

#### `chat_verified`
Server confirms verification result.

Success:
```json
{
  "type": "chat_verified",
  "success": true
}
```

Failure:
```json
{
  "type": "chat_verified",
  "success": false,
  "error": "Incorrect answer. Try again."
}
```

#### `chat_message`
Server broadcasts a chat message to all connected clients.
```json
{
  "type": "chat_message",
  "nickname": "JohnDoe",
  "text": "Hello everyone!",
  "timestamp": "2026-02-11T15:56:10.123Z"
}
```

#### `chat_error`
Server reports an error condition.
```json
{
  "type": "chat_error",
  "error": "You are sending messages too quickly."
}
```

## Implementation Details

### Server-Side (server.js)

#### Per-Connection Chat State
Each WebSocket connection has a `chat` object attached:
```javascript
ws.chat = {
  nickname: null,          // User's chosen nickname
  verifiedHuman: false,    // Whether they passed the math challenge
  challenge: null,         // Current challenge object { a, b, answer, question }
  lastChatAt: 0,          // Timestamp of last message (for rate limiting)
};
```

#### Math Challenge Generation
```javascript
function generateMathChallenge() {
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
}
```

#### Message Handlers
- `handleChatInit(ws, message)`: Sets nickname, generates challenge
- `handleChatVerify(ws, message)`: Validates answer, marks user as verified
- `handleChatMessage(ws, message)`: Validates, rate-limits, and broadcasts messages

#### Security Features
1. **Nickname validation**: Trimmed, length-checked
2. **Message validation**: Trimmed, length-checked, empty messages ignored
3. **Rate limiting**: Enforced via `CHAT_MESSAGE_COOLDOWN_MS`
4. **Challenge verification**: Must solve math problem before chatting
5. **No persistence**: Messages never written to disk

### Client-Side (app.js)

#### Chat State Variables
```javascript
let chatVerified = false;  // Whether user has passed verification
let chatNickname = "";     // User's chosen nickname
```

#### UI States
1. **Setup**: Enter nickname and start chat
2. **Challenge**: Answer math problem to verify
3. **Main**: Send and receive messages

#### Event Handlers
- Start Chat: Sends `chat_init` message
- Verify: Sends `chat_verify` message
- Send: Sends `chat_message` message
- Enter key support for all inputs

## Privacy and Data Handling

### What is NOT Stored
- ❌ Chat messages (not written to logs, files, or database)
- ❌ User identities or authentication tokens
- ❌ IP addresses associated with messages
- ❌ Message history beyond current session

### What is Stored (Temporarily)
- ✅ Nickname (in WebSocket connection memory only)
- ✅ Verification status (in WebSocket connection memory only)
- ✅ Last message timestamp (for rate limiting, in memory only)

All of the above is cleared when:
- The WebSocket connection closes
- The server restarts
- The user refreshes the page

## Testing

The chat system includes comprehensive tests in `__tests__/chat.test.js`:

- Math challenge generation validation
- Nickname and message length enforcement
- Rate limiting logic
- Challenge verification (correct/incorrect answers)
- Environment variable configuration
- Message format validation

Run tests with:
```bash
npm test
```

## Backwards Compatibility

The chat implementation is fully backwards compatible:

1. **No breaking changes** to existing WebSocket message types
2. **Additive only**: New message types are simply added, not replacing anything
3. **Old clients work**: Clients that don't know about chat continue to receive status updates
4. **Graceful degradation**: If an old server receives chat messages, they're safely ignored

## Customization

### Adjusting Rate Limits
```bash
# Allow messages every 2 seconds instead of 1
export CHAT_MESSAGE_COOLDOWN_MS=2000
```

### Changing Challenge Difficulty
```bash
# Harder math problems (15-30 range)
export CHAT_MATH_MIN=15
export CHAT_MATH_MAX=30
```

### Limiting Message Size
```bash
# Shorter messages (200 characters)
export CHAT_MESSAGE_MAX_LENGTH=200
```

## Future Enhancements (Not Implemented)

Potential features that could be added:

- Per-IP message rate limiting (in addition to per-connection)
- Profanity filter
- Admin commands (kick, ban)
- Message reactions or emojis
- Typing indicators
- User list display
- Private/direct messages

## Troubleshooting

### Messages not appearing
- Check browser console for WebSocket errors
- Verify server is running and WebSocket connection is established
- Ensure you've completed the math challenge verification

### Rate limit errors
- Wait for the cooldown period (default 1 second) before sending another message
- Adjust `CHAT_MESSAGE_COOLDOWN_MS` if needed

### Challenge not showing
- Ensure nickname was entered and "Start Chat" was clicked
- Check browser console for errors
- Verify WebSocket connection is open

## Security Considerations

1. **No XSS**: Messages are displayed as text content, not HTML
2. **Rate limiting**: Prevents message flooding
3. **Length limits**: Prevents oversized messages
4. **Math challenge**: Reduces bot spam
5. **No persistence**: Minimizes data exposure risk
6. **Client-side validation**: HTML input maxlength attributes as first defense
7. **Server-side validation**: All inputs validated and sanitized on server

## Support

For issues or questions, please refer to:
- GitHub Issues: https://github.com/Minecrafter8001/print-monitor/issues
- Main README: https://github.com/Minecrafter8001/print-monitor/blob/main/README.md
