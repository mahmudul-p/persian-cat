// VS Code side: installs the cat runtime into the workbench window and keeps it in sync with settings.
// The extension host cannot draw over the editor, so the cat itself lives in media/cat.js,
// which is copied next to workbench.html and loaded by VS Code's own window.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { RUNTIME, STATE_FILE, patchHtml, workbenchDir, removeFrom } = require('./patch');

function runtimeSource(ctx) {
	const c = vscode.workspace.getConfiguration('persianCat');
	const cfg = {
		enabled: c.get('enabled'),
		size: c.get('size'),
		frequency: c.get('frequency'),
		mouseInteraction: c.get('mouseInteraction'),
	};
	const engine = fs.readFileSync(path.join(ctx.extensionPath, 'media', 'cat.js'), 'utf8');
	return `window.__PERSIAN_CAT__ = ${JSON.stringify(cfg)};\n${engine}`;
}

/** Writes runtime + patches workbench.html. Returns true if anything on disk changed. */
function install(ctx) {
	const dir = workbenchDir(vscode.env.appRoot);
	const htmlPath = path.join(dir, 'workbench.html');
	const jsPath = path.join(dir, RUNTIME);
	let changed = false;

	const src = runtimeSource(ctx);
	if (!fs.existsSync(jsPath) || fs.readFileSync(jsPath, 'utf8') !== src) {
		fs.writeFileSync(jsPath, src);
		changed = true;
	}
	const html = fs.readFileSync(htmlPath, 'utf8');
	const patched = patchHtml(html);
	if (patched !== html) {
		fs.writeFileSync(htmlPath, patched);
		changed = true;
	}
	fs.writeFileSync(STATE_FILE, JSON.stringify({ dir }));
	return changed;
}

function explain(err) {
	if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
		return `Persian Cat cannot write to the VS Code install folder (${vscode.env.appRoot}). ` +
			'If your account is not an administrator, run a copy of VS Code from ~/Applications (your own folder) instead, ' +
			'or have an admin give your user ownership of the app. Otherwise (macOS) allow Visual Studio Code in ' +
			'System Settings › Privacy & Security › App Management, then retry.';
	}
	return `Persian Cat: ${err && err.message ? err.message : err}`;
}

async function reloadPrompt(msg) {
	if (await vscode.window.showInformationMessage(msg, 'Reload Window') === 'Reload Window') {
		vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}

function activate(ctx) {
	const installed = () => ctx.globalState.get('installed', false);

	const doInstall = async () => {
		try {
			install(ctx);
			await ctx.globalState.update('installed', true);
			reloadPrompt('Persian Cat is in. Reload the window to meet it. (VS Code may then say the installation is "corrupt" — that is the cat; choose "Don\'t Show Again".)');
		} catch (e) {
			vscode.window.showErrorMessage(explain(e));
		}
	};

	ctx.subscriptions.push(
		vscode.commands.registerCommand('persianCat.install', doInstall),
		vscode.commands.registerCommand('persianCat.uninstall', async () => {
			try {
				removeFrom(workbenchDir(vscode.env.appRoot));
				await ctx.globalState.update('installed', false);
				reloadPrompt('Persian Cat removed and VS Code files restored. Reload to finish.');
			} catch (e) {
				vscode.window.showErrorMessage(explain(e));
			}
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (!e.affectsConfiguration('persianCat') || !installed()) return;
			try {
				if (install(ctx)) reloadPrompt('Persian Cat settings changed. Reload to apply.');
			} catch (e2) {
				vscode.window.showErrorMessage(explain(e2));
			}
		}),
	);

	if (installed()) {
		// VS Code updates replace workbench.html; extension updates change cat.js. Re-sync either way.
		try {
			if (install(ctx)) reloadPrompt('Persian Cat was re-added after an update. Reload to see it.');
		} catch (e) {
			vscode.window.showErrorMessage(explain(e));
		}
	} else if (!ctx.globalState.get('offered', false)) {
		ctx.globalState.update('offered', true);
		vscode.window.showInformationMessage(
			'Let the Persian cat into VS Code? This adds a small script to VS Code\'s window (undo any time with "Persian Cat: Remove").',
			'Let it in',
		).then(pick => pick && doInstall());
	}
}

module.exports = { activate, deactivate() {} };
