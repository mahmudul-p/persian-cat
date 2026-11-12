// Pure file helpers for adding/removing the cat <script> in VS Code's workbench.html.
// Shared by extension.js, uninstall.js (vscode:uninstall hook) and test.js — no `vscode` import here.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNTIME = 'persian-cat.js';
const START = '<!-- persian-cat -->';
const END = '<!-- /persian-cat -->';
const TAG = `${START}<script src="./${RUNTIME}"></script>${END}`;
const STATE_FILE = path.join(os.homedir(), '.vscode-persian-cat.json');

function unpatchHtml(html) {
	const i = html.indexOf(START);
	if (i < 0) return html;
	const j = html.indexOf(END, i);
	return html.slice(0, i).replace(/\n$/, '') + html.slice(j + END.length);
}

function patchHtml(html) {
	const clean = unpatchHtml(html);
	const at = clean.lastIndexOf('</html>');
	return at < 0 ? `${clean}\n${TAG}\n` : `${clean.slice(0, at)}${TAG}\n${clean.slice(at)}`;
}

/** Folder holding workbench.html; the sub-folder name changed across VS Code versions. */
function workbenchDir(appRoot) {
	for (const sub of ['electron-browser', 'electron-sandbox']) {
		const dir = path.join(appRoot, 'out', 'vs', 'code', sub, 'workbench');
		if (fs.existsSync(path.join(dir, 'workbench.html'))) return dir;
	}
	throw new Error(`workbench.html not found under ${appRoot}`);
}

/** Restore workbench.html and delete the runtime script. Safe to call repeatedly. */
function removeFrom(dir) {
	const html = path.join(dir, 'workbench.html');
	const src = fs.readFileSync(html, 'utf8');
	const out = unpatchHtml(src);
	if (out !== src) fs.writeFileSync(html, out);
	fs.rmSync(path.join(dir, RUNTIME), { force: true });
	fs.rmSync(STATE_FILE, { force: true });
}

module.exports = { RUNTIME, STATE_FILE, patchHtml, unpatchHtml, workbenchDir, removeFrom };
