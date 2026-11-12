// Runs via the `vscode:uninstall` hook so uninstalling the extension never leaves the cat behind.
const fs = require('fs');
const { STATE_FILE, removeFrom } = require('./patch');

try {
	const { dir } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
	removeFrom(dir);
} catch {
	// Nothing installed, or already removed.
}
