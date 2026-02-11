# Chat Data Directory

This directory contains JSON files for managing chat features:

## Files

### reserved-nicknames.json
Maps reserved nicknames to password hashes. Users claiming these nicknames must provide the correct password.

Example:
```json
{
  "Admin": {
    "passwordHash": "sha256_hash_here",
    "description": "Optional description"
  }
}
```

To generate a password hash, use:
```bash
echo -n "yourpassword" | sha256sum
```

### verified-ips.json
Tracks IPs that have been verified for specific nicknames. Auto-authenticates returning users.

Example:
```json
{
  "192.168.1.100": {
    "nickname": "Admin",
    "verifiedAt": "2026-02-11T16:00:00.000Z",
    "lastSeenAt": "2026-02-11T16:00:00.000Z"
  }
}
```

### blocked-words.json
List of words that cannot be used in nicknames or messages.

Example:
```json
[
  "spam",
  "badword1",
  "badword2"
]
```

## Setup

1. Copy example files to create your configuration:
   ```bash
   cp reserved-nicknames.example.json reserved-nicknames.json
   cp verified-ips.example.json verified-ips.json
   cp blocked-words.example.json blocked-words.json
   ```

2. Edit the files to add your reserved nicknames, initial IPs, and blocked words

3. The actual JSON files (without .example) are gitignored for security
