# Copilot Instructions for Elegoo Print Monitor

## Project Overview
- **Purpose:** Real-time monitoring of Elegoo 3D printers (Centauri Carbon and others using SDCP) via a Node.js web server.
- **Architecture:**
  - `server.js`: Main Express server, handles HTTP API and WebSocket proxying to printers.
  - `utils/printer-discovery.js`: Discovers printers on the LAN using UDP broadcast (port 3000, message "M99999").
  - `utils/sdcp-client.js`: Implements SDCP protocol over WebSocket (`ws://PRINTER_IP:3030/websocket`).
  - `public/`: Web UI (HTML, CSS, JS) for live status and camera feed.
  - `utils/websocket-tester.js`: CLI tool for manual SDCP/WebSocket testing.

## Key Patterns & Conventions
- **Printer Discovery:** Use `PrinterDiscovery.discover(timeout)` to find printers. Returns array of printer info objects.
- **SDCP Commands:**
  - `sendCommand(cmdId, data)` on SDCPClient sends JSON commands. Common IDs:
    - `0`: Status
    - `1`: Attributes
    - `386`: Camera URL
- **WebSocket Data Flow:**
  - Server acts as a proxy between browser and printer, relaying SDCP messages.
  - Real-time updates are pushed to the browser via WebSocket.
- **Manual Testing:** Use `utils/websocket-tester.js` for CLI-based SDCP command testing.

## Developer Workflows
- **Start server:** `npm start` (see `package.json`)
- **Install deps:** `npm install`
- **Web UI:** Open `http://localhost:3000` after starting server.
- **Manual connect:** `curl -X POST http://localhost:3000/api/connect/<printer-ip>`
- **Test SDCP:** Run `node utils/websocket-tester.js` for interactive CLI.

## Integration Points
- **External:**
  - Elegoo printers (SDCP protocol)
  - Browser clients (WebSocket, HTTP)
- **Dependencies:**
  - `express`, `ws`, `uuid` (see `package.json`)

## Project-Specific Notes
- No authentication (local network only)
- Auto-reconnect logic in server and client
- Camera feed may not be available on all printers (command 386)
- All network communication is local (UDP 3000, TCP 3030)

## References
- See `README.md` for API endpoints, troubleshooting, and architecture diagram.
- Example SDCP usage: `utils/websocket-tester.js`, `utils/sdcp-client.js`
- Printer discovery: `utils/printer-discovery.js`
- Web UI: `public/app.js`, `public/index.html`

---
If any conventions or workflows are unclear, check `README.md` or ask for clarification.
