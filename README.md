# Persian Cat for VS Code

A fluffy, procedurally animated Persian cat that visits your editor, wanders, sits, grooms,
scratches, yawns, stretches, naps, gets the zoomies, and chases/pounces on your mouse pointer.
It is click-through: typing, selecting and clicking work normally underneath it.

## How it works
VS Code's extension API cannot draw over the editor or read the mouse, so on
**Persian Cat: Let the Cat In** the extension copies `media/cat.js` next to VS Code's
`workbench.html` and adds one `<script>` tag. Consequences:

- VS Code shows "Your installation appears to be corrupt" — choose *Don't Show Again*.
- After a VS Code update the extension re-adds the cat automatically and asks you to reload.
- macOS: VS Code needs *System Settings › Privacy & Security › App Management* permission to write its own folder.
- **Persian Cat: Remove** (or uninstalling the extension) restores the original files.

## Settings
| Setting | Default | |
|---|---|---|
| `persianCat.enabled` | `true` | Show the cat |
| `persianCat.size` | `220` | Length in px (80–600) |
| `persianCat.frequency` | `normal` | `rare` / `normal` / `often` visits |
| `persianCat.mouseInteraction` | `true` | Watch, chase, pounce, get startled |

Settings changes need a window reload (you'll be prompted).

## Develop
- `npm test` — patch/unpatch self-check + syntax check.
- `preview.html` — open in a browser (via any local server) to watch the cat and trigger each behaviour.
- Run in VS Code: open this folder, press F5, then run *Persian Cat: Let the Cat In* in the new window.
  Or install for real: `ln -s "$PWD" ~/.vscode/extensions/persian-cat` and restart VS Code.

## Code map
- `extension.js` — commands, settings sync, re-patch after updates.
- `patch.js` — pure workbench.html patch/unpatch helpers.
- `media/cat.js` — the cat: fur sprite painter, 2D rig, gait, actions/brain, mouse reactions.
- `uninstall.js` — `vscode:uninstall` cleanup hook.
