// Self-check: workbench.html patching is idempotent and fully reversible; cat.js parses.
const assert = require('assert');
const { execFileSync } = require('child_process');
const { patchHtml, unpatchHtml } = require('./patch');

const html = '<!DOCTYPE html>\n<html>\n<body></body>\n<script src="./workbench.js" type="module"></script>\n</html>\n';
const once = patchHtml(html);
assert.ok(once.includes('persian-cat.js'), 'tag injected');
assert.ok(once.indexOf('persian-cat.js') > once.indexOf('workbench.js'), 'injected after workbench.js');
assert.strictEqual(patchHtml(once), once, 'patch is idempotent');
assert.strictEqual(unpatchHtml(once), html, 'unpatch restores original exactly');
assert.strictEqual(unpatchHtml(html), html, 'unpatch of clean file is a no-op');
execFileSync(process.execPath, ['--check', `${__dirname}/media/cat.js`]);
console.log('ok');
