# Reserved Nicknames, IP Tracking, and Blocked Words - Extended Features

This document covers the advanced chat features added to the print monitor system.

## Overview

Three new features have been added to the chat system:

1. **Reserved Nicknames**: Special nicknames that require password authentication
2. **IP Tracking**: Automatic verification of returning users from known IPs
3. **Blocked Word Filter**: Prevention of inappropriate content in nicknames and messages

## Reserved Nicknames

### What are Reserved Nicknames?

Reserved nicknames are special usernames that require password authentication instead of the standard math challenge. This is useful for:
- Administrator accounts
- Moderator accounts
- Special role accounts (e.g., "Support", "Admin", "Moderator")

### Configuration

Reserved nicknames are configured in `data/reserved-nicknames.json`:

```json
{
  "Admin": {
    "passwordHash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
    "description": "Administrator account (password: 'password')"
  },
  "Moderator": {
    "passwordHash": "another_sha256_hash_here",
    "description": "Moderator account"
  }
}
```

### Generating Password Hashes

Passwords are stored as SHA-256 hashes for security. To generate a hash:

**Using command line:**
```bash
echo -n "yourpassword" | sha256sum
```

**Using Node.js:**
```javascript
const crypto = require('crypto');
const hash = crypto.createHash('sha256').update('yourpassword').digest('hex');
console.log(hash);
```

### Authentication Flow

When a user selects a reserved nickname:

1. **First Time (New IP)**:
   - User enters reserved nickname → Password prompt appears
   - User enters password → Server validates against hash
   - If correct: User is verified AND IP is saved for future logins
   - If incorrect: New password prompt (user can retry)

2. **Returning User (Known IP)**:
   - User enters reserved nickname → Auto-verified immediately
   - No password required
   - Toast notification: "Welcome back! Auto-verified from known IP."

### Security Considerations

- **Password Storage**: Only SHA-256 hashes are stored, never plaintext passwords
- **IP Binding**: Each verified IP is tied to a specific nickname
- **Session Persistence**: IP verification survives server restarts (stored in JSON)
- **No IP Spoofing Protection**: This is a basic system - consider IP verification as convenience, not security

## IP Tracking

### What is IP Tracking?

IP tracking saves the IP addresses of users who successfully verify with reserved nicknames. This allows automatic re-authentication for returning users.

### Configuration

Verified IPs are stored in `data/verified-ips.json`:

```json
{
  "192.168.1.100": {
    "nickname": "Admin",
    "verifiedAt": "2026-02-11T16:00:00.000Z",
    "lastSeenAt": "2026-02-11T17:30:00.000Z"
  },
  "10.0.0.50": {
    "nickname": "Moderator",
    "verifiedAt": "2026-02-11T15:00:00.000Z",
    "lastSeenAt": "2026-02-11T16:45:00.000Z"
  }
}
```

### How It Works

1. **Verification**: When a user successfully enters the correct password for a reserved nickname, their IP is saved
2. **Auto-Login**: Next time they connect from the same IP with the same nickname, they're automatically verified
3. **Timestamp Tracking**: The system tracks when the IP was first verified (`verifiedAt`) and last seen (`lastSeenAt`)
4. **Persistence**: Data survives server restarts

### Privacy & Data Retention

- IP addresses are **only** tracked for users who claim reserved nicknames
- Regular users (non-reserved nicknames) are **never** tracked
- IPs are stored locally in `data/verified-ips.json` (gitignored)
- No external services or databases are used
- To clear IP tracking: delete or edit `verified-ips.json`

## Blocked Words

### What are Blocked Words?

Blocked words are terms that cannot be used in nicknames or chat messages. This helps maintain a respectful chat environment.

### Configuration

Blocked words are configured in `data/blocked-words.json`:

```json
[
  "spam",
  "moderator",
  "bot"
]
```

- Words are case-insensitive
- Whole-word matching (with word boundaries)
- Simple list format for easy editing

### How It Works

1. **Nickname Check**: When a user tries to set a nickname, it's checked against the blocked word list
2. **Message Check**: When a user sends a message, it's checked against the blocked word list
3. **Reserved Override**: Reserved nicknames are checked **before** blocked words, so you can have "Admin" as a reserved nickname even if "admin" is blocked

### Word Matching Rules

- **Case-Insensitive**: "spam", "SPAM", "Spam" all match "spam"
- **Word Boundaries**: "spam" matches "spam message" but NOT "spammer" or "aspam"
- **First Match**: If multiple blocked words are present, the first one found is reported

### Examples

```javascript
// Blocked (assuming "spam" and "bot" are in the list)
"spam"              → Blocked: "spam"
"This is spam"      → Blocked: "spam"
"bot here"          → Blocked: "bot"
"SPAM message"      → Blocked: "spam"

// Allowed
"spammer"           → Allowed (not whole word match)
"robot"             → Allowed (not whole word match)
"Hello everyone!"   → Allowed (no blocked words)
```

## Integration with Existing Chat

### Message Type Flow

The new features integrate seamlessly with existing chat:

```
Regular User Flow:
  chat_init → chat_challenge → chat_verify → chat_message

Reserved Nickname Flow (First Time):
  chat_init → chat_password_required → chat_verify (with password) → chat_message

Reserved Nickname Flow (Known IP):
  chat_init → chat_verified (auto) → chat_message
```

### New WebSocket Messages

**Server → Client:**
- `chat_password_required`: Requests password for reserved nickname
  ```json
  {
    "type": "chat_password_required",
    "message": "This is a reserved nickname. Please enter the password."
  }
  ```

**Client → Server:**
- Modified `chat_verify`: Can now include password field
  ```json
  {
    "type": "chat_verify",
    "password": "user_entered_password"
  }
  ```

**Server → Client (Enhanced):**
- `chat_verified`: Now includes optional message field
  ```json
  {
    "type": "chat_verified",
    "success": true,
    "message": "Welcome back! Auto-verified from known IP."
  }
  ```

- `chat_error`: Reports blocked words and other errors
  ```json
  {
    "type": "chat_error",
    "error": "Nickname contains blocked word: \"spam\""
  }
  ```

## File Structure

```
/data/
  ├── README.md                           # Documentation for data files
  ├── reserved-nicknames.example.json     # Example reserved nicknames (committed)
  ├── reserved-nicknames.json             # Actual reserved nicknames (gitignored)
  ├── verified-ips.example.json           # Example verified IPs (committed)
  ├── verified-ips.json                   # Actual verified IPs (gitignored)
  ├── blocked-words.example.json          # Example blocked words (committed)
  └── blocked-words.json                  # Actual blocked words (gitignored)

/utils/
  └── chat-data.js                        # Data management utility module
```

## Setup Instructions

### First-Time Setup

1. **Copy Example Files:**
   ```bash
   cd data
   cp reserved-nicknames.example.json reserved-nicknames.json
   cp verified-ips.example.json verified-ips.json
   cp blocked-words.example.json blocked-words.json
   ```

2. **Edit Reserved Nicknames:**
   ```bash
   # Generate a password hash
   echo -n "your_secure_password" | sha256sum
   
   # Edit reserved-nicknames.json and add your nickname with the hash
   ```

3. **Customize Blocked Words:**
   ```bash
   # Edit blocked-words.json to add words you want to block
   ```

4. **Start Server:**
   ```bash
   npm start
   ```

The server will automatically load the data files on startup.

### Adding a New Reserved Nickname

1. Generate password hash:
   ```bash
   echo -n "mysecretpassword" | sha256sum
   # Output: abc123def456...
   ```

2. Edit `data/reserved-nicknames.json`:
   ```json
   {
     "YourNickname": {
       "passwordHash": "abc123def456...",
       "description": "Your account description"
     }
   }
   ```

3. Restart the server or reload data

### Managing IP Tracking

**View tracked IPs:**
```bash
cat data/verified-ips.json
```

**Remove a specific IP:**
Edit `verified-ips.json` and delete the IP entry, then save.

**Clear all tracked IPs:**
```bash
echo "{}" > data/verified-ips.json
```

### Managing Blocked Words

**Add a word:**
Edit `data/blocked-words.json` and add to the array:
```json
[
  "spam",
  "bot",
  "newblockedword"
]
```

**Remove a word:**
Delete from the array and save.

**Note**: Restart required after modifying blocked words.

## API / Code Usage

### Using chat-data.js Module

```javascript
const ChatData = require('utils/chat-data');

// Load all data files
ChatData.loadData();

// Check if nickname is reserved
const isReserved = ChatData.isReservedNickname('Admin');

// Verify password
const isValid = ChatData.verifyPassword('Admin', 'password');

// Check IP verification
const isVerified = ChatData.isIPVerified('192.168.1.100', 'Admin');

// Add verified IP
ChatData.addVerifiedIP('192.168.1.100', 'Admin');

// Update last seen
ChatData.updateIPLastSeen('192.168.1.100');

// Check for blocked words
const blockedWord = ChatData.containsBlockedWord('This is spam');
if (blockedWord) {
  console.log(`Found blocked word: ${blockedWord}`);
}

// Hash a password
const hash = ChatData.hashPassword('mypassword');
```

## Security Notes

### Password Security
- ✅ Passwords stored as SHA-256 hashes
- ✅ Never transmitted or logged in plaintext
- ⚠️ SHA-256 is not salted (suitable for low-security applications only)
- ⚠️ For high-security needs, consider bcrypt or similar

### IP Tracking Security
- ⚠️ IPs can be spoofed in some network configurations
- ⚠️ Users behind the same NAT/proxy share IPs
- ⚠️ Dynamic IPs may change, breaking auto-verification
- ✅ IP data stored locally, not in external databases
- ✅ Privacy-friendly: only tracks users who claim reserved nicknames

### Blocked Words
- ✅ Provides basic content filtering
- ⚠️ Easily bypassed with character substitution (e.g., "sp@m")
- ⚠️ May have false positives with word boundaries
- ✅ Easy to update and customize

## Backwards Compatibility

All new features are **100% backwards compatible**:

- ✅ Clients without password support still work with regular nicknames
- ✅ Existing math challenge flow unchanged for regular users
- ✅ Empty data files cause no errors (defaults to no reserved nicknames, no blocked words)
- ✅ All existing tests continue to pass

## Troubleshooting

### "Nickname contains blocked word" but it shouldn't

**Cause**: Blocked word list includes a substring of your nickname

**Solution**: Check `data/blocked-words.json` and remove the conflicting word, or choose a different nickname

### Reserved nickname won't accept password

**Causes**:
1. Password hash is incorrect
2. JSON syntax error in `reserved-nicknames.json`
3. Server needs restart after changing files

**Solutions**:
1. Regenerate the password hash: `echo -n "password" | sha256sum`
2. Validate JSON syntax: `python -m json.tool data/reserved-nicknames.json`
3. Restart the server

### Auto-verification not working

**Causes**:
1. IP changed (dynamic IP)
2. Browser/network using different IP
3. `verified-ips.json` was cleared or reset

**Solution**: Re-verify with password once, IP will be saved again

### Data files not loading

**Check server startup logs** for errors like:
```
[ChatData] Error loading data: ...
```

**Common issues**:
- JSON syntax errors
- File permissions
- Files don't exist (copy from .example files)

## Testing

The implementation includes comprehensive tests:

```bash
# Run all tests
npm test

# Run just the auth tests
npm test -- chat-auth.test.js
```

**Test Coverage**:
- Password hashing (SHA-256)
- Reserved nickname detection
- Password verification
- IP tracking (add, verify, update)
- Blocked word filtering
- Message validation

## Future Enhancements

Possible improvements:

- [ ] Salted password hashes (bcrypt/argon2)
- [ ] IP whitelist/blacklist
- [ ] Timeout for IP verification (auto-expire after X days)
- [ ] More sophisticated word filtering (regex patterns, leetspeak detection)
- [ ] Admin commands for managing users
- [ ] Audit log for reserved nickname logins
- [ ] Rate limiting per IP
- [ ] Multi-factor authentication

## Support

For issues or questions:
- See main `CHAT_DOCUMENTATION.md` for basic chat features
- Check `data/README.md` for data file format details
- Review test files in `__tests__/chat-auth.test.js` for usage examples
