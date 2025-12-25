# Elegoo Print Monitor - AI Coding Instructions

## Project Overview
Node.js web server for monitoring Elegoo 3D printers (Centauri Carbon) with real-time status and camera feed. Uses custom SDCP protocol (Smart Device Communication Protocol) over WebSocket for printer communication.

## Architecture

### Three-Layer Communication Model
1. **Printer Layer** ([sdcp-client.js](sdcp-client.js)): WebSocket client to printer's SDCP server (port 3030)
   - Request-response pattern with UUID-based message tracking (`messageHandlers` Map)
   - Commands use numeric Cmd IDs: `0` (status), `1` (attributes), `386` (camera URL)
   - Auto-reconnection with 5s interval on disconnect
   
2. **Server Layer** ([server.js](server.js)): Express + WebSocket hybrid server
   - Status polling at 2s intervals via `requestStatus()`
   - Camera streaming proxies printer's multipart/x-mixed-replace MJPEG stream
   - Publishes updates to web clients via WebSocket broadcast
   
3. **Client Layer** ([public/app.js](public/app.js)): Browser WebSocket client
   - Receives real-time status via `{ type: 'status', data: buildStatusPayload() }`
   - Camera renders via `<img src="/api/camera">` MJPEG endpoint

### Data Flow
```
Printer (SDCP/WS:3030) 
  ↓ poll every 2s
Server (Express:3000 + WS)
  ↓ broadcast on change
Browser (WebSocket client)
```

## Critical Patterns

### SDCP Message Structure
All printer commands follow this format:
```javascript
{
  Id: uuidv4(),
  Data: {
    Cmd: 0,              // Command ID
    Data: {},            // Command payload
    RequestID: uuidv4(), // For response tracking
    MainboardID: "...",  // Extracted from first response
    TimeStamp: unixTime,
    From: 0
  },
  Topic: "sdcp/request/{MainboardID}"
}
```

### User Tracking IP Detection
Custom IP detection with Cloudflare/proxy support ([server.js](server.js#L64-L99)):
- Prioritizes `x-forwarded-for` (excluding 192.168.x.x)
- Falls back to `cf-connecting-ip` → `remoteAddress`
- Normalizes IPv6-mapped IPv4 (`::ffff:` prefix)
- Tracks unique IPs in `Set()` for analytics

### Camera Streaming Relay
Server parses multipart boundaries from printer's HTTP stream and relays to subscribers:
- Maintains `latestFrame` Buffer for immediate replay to new clients
- `cameraSubscribers` Set holds write functions for each `/api/camera` request
- Boundary parsing in [server.js](server.js#L426-L479)

## Development Commands

```bash
npm start                    # Start server (port 3000)
PORT=8080 npm start          # Custom port
npx pm2 start ecosystem.config.js  # Production with PM2
```

No build step required (vanilla Node.js). No tests defined.

## Environment Variables
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Set to "production" in [ecosystem.config.js](ecosystem.config.js#L10)

## Printer Discovery
UDP broadcast on port 3000 with magic string `"M99999"` ([printer-discovery.js](printer-discovery.js#L9)):
- Printers respond with JSON containing `Name`, `Id`, etc.
- Used on startup (`autoConnect()`) and `/api/discover` endpoint

## Key State Management

### Global `printerStatus` Object
Central state in [server.js](server.js#L22-L38), updated by `updatePrinterStatus()`:
- `state`: Mapped from `CurrentStatus` array (0=Idle, 1=Printing, 2=Paused, etc.)
- `progress`: Direct from `PrintInfo.Progress` (percentage)
- `layerProgress`: Calculated from `CurrentLayer/TotalLayer` to 6 decimals
- `temperatures`: Uses printer fields `TempOfHotbed`, `TempOfNozzle`, `TempOfBox`
- `calculatedTime`: ETA based on progress vs. elapsed time

### Timer Values
All time values in seconds (converted from printer's "ticks"):
```javascript
printerStatus.printTime = Math.floor(s.PrintInfo.CurrentTicks || 0);
printerStatus.remainingTime = Math.floor(totalTicks - printerStatus.printTime);
```

## Error Handling Conventions
- Camera errors: Check `Ack` field in response (see `CAMERA_ACK_ERRORS` map)
- WebSocket errors: Always implement auto-reconnect (5s interval pattern)
- Command timeouts: 10s timeout on all `sendCommand()` calls
- No global error handler - errors logged via `console.error()`

## Testing Locally
1. Ensure Elegoo printer is on same network
2. Printer must have camera enabled (some models lack camera)
3. Check printer's IP responds to UDP broadcast
4. Manual connection: `curl -X POST http://localhost:3000/api/connect/<PRINTER_IP>`

## File-Specific Notes
- [public/index.html](public/index.html): Renders status cards, uses SSE-like model for camera
- [public/style.css](public/style.css): State-based classes (`.printing`, `.paused`, etc.)
- [ecosystem.config.js](ecosystem.config.js): PM2 config limits memory to 300MB

## Common Gotchas
- Camera URL from printer is returned as `VideoUrl: "192.168.x.x:8080/stream"` (no protocol)
- `MainboardID` must be extracted from first response before other commands work
- WebSocket broadcast in [server.js](server.js#L346) only sends to clients with `readyState === OPEN`
- First status update is always logged for debugging ([server.js](server.js#L248-L252))
