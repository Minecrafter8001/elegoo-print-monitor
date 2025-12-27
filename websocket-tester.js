const client = require('./sdcp-client');
const discovery = require('./printer-discovery');
const readline = require('readline');

// Helper to prompt user
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

let wsClient = null;

function printMenu() {
	console.log('\nElegoo WebSocket Tester');
	console.log('1. Discover printers');
	console.log('2. Connect to printer');
	console.log('3. Send status command');
	console.log('4. Send attributes command');
	console.log('5. Send camera URL command');
	console.log('6. Send custom command');
	console.log('0. Exit');
}

function ask(question) {
	return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
	let printerIP = null;
	let mainboardID = null;
	while (true) {
		printMenu();
		const choice = await ask('Select option: ');
		if (choice === '0') break;
		if (choice === '1') {
			console.log('Discovering printers...');
			discovery.discoverPrinters(3000, (printers) => {
				if (printers.length === 0) {
					console.log('No printers found.');
				} else {
					printers.forEach((p, i) => {
						console.log(`${i + 1}: ${p.Name} (${p.Ip})`);
					});
				}
			});
		} else if (choice === '2') {
			printerIP = await ask('Enter printer IP: ');
			wsClient = new client(printerIP);
			wsClient.on('open', () => {
				console.log('Connected to printer.');
			});
			wsClient.on('message', (msg) => {
				try {
					const data = JSON.parse(msg);
					if (data.Data && data.Data.MainboardID) mainboardID = data.Data.MainboardID;
				} catch {}
				console.log('Received:', msg);
			});
			wsClient.on('close', () => {
				console.log('Connection closed.');
			});
			wsClient.on('error', (err) => {
				console.error('WebSocket error:', err);
			});
		} else if (choice === '3') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			wsClient.sendCommand(0, {}, 10000).then(res => {
				console.log('Status response:', res);
			}).catch(console.error);
		} else if (choice === '4') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			wsClient.sendCommand(1, {}, 10000).then(res => {
				console.log('Attributes response:', res);
			}).catch(console.error);
		} else if (choice === '5') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			wsClient.sendCommand(386, {}, 10000).then(res => {
				console.log('Camera URL response:', res);
			}).catch(console.error);
		} else if (choice === '6') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			const cmd = parseInt(await ask('Enter Cmd ID (number): '), 10);
			const dataStr = await ask('Enter Data payload (JSON): ');
			let data = {};
			try { data = JSON.parse(dataStr); } catch { console.log('Invalid JSON, using empty object.'); }
			wsClient.sendCommand(cmd, data, 10000).then(res => {
				console.log('Custom command response:', res);
			}).catch(console.error);
		} else {
			console.log('Unknown option.');
		}
	}
	rl.close();
	if (wsClient && wsClient.close) wsClient.close();
	process.exit(0);
}

main();



