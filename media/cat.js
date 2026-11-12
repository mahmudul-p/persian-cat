/* Persian Cat — runtime loaded inside the VS Code workbench window (or preview.html).
 *
 * Rendering: a click-through full-window <canvas>. The cat is a 2D cut-out rig whose
 * parts (body, chest ruff, haunch, legs, paws, head, ears, tail segments) are fur sprites
 * painted once from thousands of shaded strands, then posed every frame. Face (eyes,
 * nose, mouth, whiskers) is drawn live so it can blink, yawn and follow the pointer.
 *
 * Motion: every behaviour is an "action" that sets a posture + pose overlay (optionally
 * keyframed); the live pose eases toward that target, so all transitions are smooth.
 * Legs auto-reach the ground, a gait generator blends walk -> gallop, and the tail is a
 * travelling wave. A small weighted "brain" picks the next action and reacts to the mouse.
 */
(() => {
	'use strict';
	const CFG = Object.assign({ enabled: true, size: 220, frequency: 'normal', mouseInteraction: true }, window.__PERSIAN_CAT__);
	if (!CFG.enabled || window.__persianCat) return;

	// ---------------------------------------------------------------- config & utils
	const TAU = Math.PI * 2, PI = Math.PI;
	const S = Math.max(80, Math.min(600, Number(CFG.size) || 220)); // cat length, px
	const K = S / 200; // stroke scale
	const DPR = Math.min(2, window.devicePixelRatio || 1);
	const G = S * 9; // gravity, px/s²
	const FREQS = {
		rare: { away: [240, 600], visit: [5, 9] },
		normal: { away: [60, 180], visit: [7, 13] },
		often: { away: [15, 45], visit: [10, 18] },
	};
	const FREQ = FREQS[CFG.frequency] || FREQS.normal;

	const rand = (a, b) => a + Math.random() * (b - a);
	const chance = p => Math.random() < p;
	const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
	const lerp = (a, b, t) => a + (b - a) * t;
	const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
	const smooth = t => t * t * (3 - 2 * t);
	const weighted = w => {
		let r = Math.random() * Object.values(w).reduce((s, v) => s + v, 0);
		for (const k in w) if ((r -= w[k]) <= 0) return k;
		return Object.keys(w)[0];
	};
	const seeded = seed => () => { // mulberry32: stable fur between reloads
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	// ---------------------------------------------------------------- fur sprites
	// Cream Persian coat, HSL: shadow → base → highlight.
	const COAT = { dark: [30, 26, 54], base: [36, 40, 80], light: [42, 60, 95] };
	function furColor(t, shade, a) {
		const [A, B, u] = t < 0.5 ? [COAT.dark, COAT.base, t * 2] : [COAT.base, COAT.light, (t - 0.5) * 2];
		return `hsla(${lerp(A[0], B[0], u)},${lerp(A[1], B[1], u)}%,${lerp(A[2], B[2], u) * shade}%,${a})`;
	}

	function makeCanvas(w, h) {
		const c = document.createElement('canvas');
		c.width = Math.ceil(w * DPR);
		c.height = Math.ceil(h * DPR);
		const g = c.getContext('2d');
		g.scale(DPR, DPR);
		g.translate(w / 2, h / 2);
		g.lineCap = 'round';
		return [c, g];
	}

	function strand(g, R, x, y, dx, dy, len, color) {
		const bend = (R() - 0.5) * len * 0.6;
		g.strokeStyle = color;
		g.lineWidth = (0.6 + R() * 1.2) * K;
		g.beginPath();
		g.moveTo(x, y);
		g.quadraticCurveTo(x + dx * len * 0.5 - dy * bend, y + dy * len * 0.5 + dx * bend, x + dx * len, y + dy * len);
		g.stroke();
	}

	/** Elliptical tuft of fur. `flow` = direction (rad) the hair falls; lit from upper-left. */
	function furBlob(rx, ry, { fringe = Math.min(rx, ry) * 0.45, flow = PI / 2, flowBias = 0.9, shade = 1, seed = 1, density = 1 } = {}) {
		const R = seeded(seed);
		const w = (rx + fringe) * 2 + 4, h = (ry + fringe) * 2 + 4;
		const [c, g] = makeCanvas(w, h);
		const grad = g.createRadialGradient(-rx * 0.3, -ry * 0.45, 0, 0, 0, Math.max(rx, ry));
		grad.addColorStop(0, furColor(0.85, shade, 1));
		grad.addColorStop(0.6, furColor(0.5, shade, 1));
		grad.addColorStop(1, furColor(0.22, shade, 1));
		g.fillStyle = furColor(0.35, shade, 0.45);
		g.filter = `blur(${fringe * 0.2}px)`;
		g.beginPath();
		g.ellipse(0, 0, rx + fringe * 0.08, ry + fringe * 0.08, 0, 0, TAU);
		g.fill();
		g.filter = 'none';
		g.fillStyle = grad;
		g.beginPath();
		g.ellipse(0, 0, rx * 0.9, ry * 0.9, 0, 0, TAU);
		g.fill();

		const fx = Math.cos(flow), fy = Math.sin(flow);
		const n = Math.round((rx / K) * (ry / K) * density * 1.6);
		for (let i = 0; i < n; i++) {
			const a = R() * TAU, d = Math.pow(R(), 0.4); // biased to the rim, where fluff shows
			const nx = Math.cos(a), ny = Math.sin(a);
			const x = nx * rx * d * 0.95, y = ny * ry * d * 0.95;
			let dx = nx * d * 0.8 + fx * flowBias * 1.3 + (R() - 0.5) * 0.5;
			let dy = ny * d * 0.8 + fy * flowBias * 1.3 + (R() - 0.5) * 0.5;
			const m = Math.hypot(dx, dy) || 1;
			dx /= m; dy /= m;
			const len = fringe * (0.25 + R() * 0.6) * (0.35 + d * 0.7);
			const light = clamp(0.55 - (y / ry) * 0.32 - (x / rx) * 0.1 + (R() - 0.5) * 0.45, 0, 1);
			strand(g, R, x, y, dx, dy, len, furColor(light, shade, 0.22 + R() * 0.4));
		}
		return { c, w, h };
	}

	function makeEar(shade, seed) {
		const s = 0.065 * S, R = seeded(seed), w = s * 2.6;
		const [c, g] = makeCanvas(w, w);
		const tri = k => {
			g.beginPath();
			g.moveTo(-s * 0.75 * k, s * 0.55);
			g.quadraticCurveTo(-s * 0.3 * k, -s * 0.3 * k, s * 0.05 * k, -s * 0.85 * k);
			g.quadraticCurveTo(s * 0.4 * k, -s * 0.2 * k, s * 0.75 * k, s * 0.55);
			g.closePath();
		};
		tri(1); g.fillStyle = furColor(0.45, shade, 1); g.fill();
		tri(0.6); g.fillStyle = `hsl(8,45%,${72 * shade}%)`; g.fill();
		for (let i = 0; i < 70; i++) { // inner tufts + rim fluff
			const inner = i < 35;
			const x = (R() - 0.5) * s * (inner ? 0.6 : 1.4), y = s * 0.5 - R() * s * (inner ? 0.7 : 0.4);
			const a = -PI / 2 + (R() - 0.5) * (inner ? 0.8 : 2.4);
			strand(g, R, x, y, Math.cos(a), Math.sin(a), s * (0.25 + R() * 0.4), furColor(inner ? 0.95 : 0.5 + R() * 0.3, shade, 0.7));
		}
		return { c, w, h: w };
	}

	const LEG_RY = 0.14 * S, LN = 1.6 * LEG_RY; // natural leg length (hip → paw)
	const SP = {
		body: furBlob(0.34 * S, 0.205 * S, { fringe: 0.085 * S, flow: PI * 0.62, seed: 11, density: 1.1 }),
		haunch: furBlob(0.16 * S, 0.155 * S, { fringe: 0.07 * S, flow: PI * 0.6, seed: 12 }),
		chest: furBlob(0.16 * S, 0.2 * S, { fringe: 0.08 * S, flow: PI * 0.48, seed: 13 }),
		head: furBlob(0.2 * S, 0.185 * S, { fringe: 0.065 * S, flow: PI * 0.5, flowBias: 0.5, seed: 14 }),
		legN: furBlob(0.058 * S, LEG_RY, { fringe: 0.04 * S, seed: 15 }),
		legF: furBlob(0.058 * S, LEG_RY, { fringe: 0.04 * S, seed: 16, shade: 0.78 }),
		pawN: furBlob(0.05 * S, 0.032 * S, { fringe: 0.018 * S, seed: 17 }),
		pawF: furBlob(0.05 * S, 0.032 * S, { fringe: 0.018 * S, seed: 18, shade: 0.78 }),
		tail: [0, 1, 2].map(i => furBlob(0.085 * S, 0.075 * S, { fringe: 0.07 * S, flow: PI, flowBias: 0.7, seed: 20 + i })),
		earN: makeEar(1, 30),
		earF: makeEar(0.82, 31),
	};

	// ---------------------------------------------------------------- canvas
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000';
	const ctx = canvas.getContext('2d');
	let W = 0, H = 0;
	function resize() {
		W = innerWidth; H = innerHeight;
		canvas.width = Math.round(W * DPR);
		canvas.height = Math.round(H * DPR);
	}

	function spr(sp, x, y, rot = 0, sx = 1, sy = 1, ax = 0, ay = 0) {
		ctx.save();
		ctx.translate(x, y);
		if (rot) ctx.rotate(rot);
		ctx.scale(sx, sy);
		ctx.drawImage(sp.c, -sp.w / 2 - ax, -sp.h / 2 - ay, sp.w, sp.h);
		ctx.restore();
	}

	// ---------------------------------------------------------------- poses
	// Units: lengths in S, angles in rad. Leg angle > 0 swings the paw forward.
	// pitch > 0 tips the front down. tailA is the tail's base direction (PI = straight back).
	const BASE = {
		crouch: 0, pitch: 0, stretch: 1, headX: 0, headY: 0, headTilt: 0, faceTurn: 0.7,
		eyeOpen: 1, mouth: 0, earBack: 0, tailA: PI + 0.35, tailCurl: 0.12, tailWag: 0.12, tailPuff: 0,
		lNH: 0, lFH: 0, lNF: 0, lFF: 0, liftNF: 0, liftNH: 0, plant: 1,
	};
	const POSTURE = {
		stand: {},
		sit: { crouch: 0.14, pitch: -0.5, lNH: 0.95, lFH: 0.85, lNF: 0.04, lFF: -0.06, tailA: PI - 0.1, tailCurl: -0.06, tailWag: 0.05, headX: -0.02, faceTurn: 0.45 },
		lie: { crouch: 0.16, pitch: 0.03, lNH: 1.3, lFH: 1.2, lNF: 1.38, lFF: 1.28, headY: 0.09, headX: 0.03, tailA: PI - 0.45, tailCurl: -0.17, tailWag: 0.02, faceTurn: 0.35 },
	};
	const AIR = { lNF: 0.95, lFF: 0.8, lNH: -0.95, lFH: -0.8, plant: 0, pitch: -0.12, tailA: PI + 0.15, tailCurl: 0.04 };
	const CROUCH = { crouch: 0.09, pitch: 0.06, lNH: 0.45, lFH: 0.4, lNF: 0.3, lFF: 0.25, tailA: PI - 0.05, tailCurl: 0.05, headY: 0.05, faceTurn: 0.85 };
	const SNIFF = { headY: 0.08, headX: 0.04, headTilt: 0.2, faceTurn: 0.9 };

	// ---------------------------------------------------------------- state
	const mouse = { x: -1e4, y: -1e4, speed: 0, energy: 0, lastMove: -1e9 };
	const cat = {
		x: 0, y: 0, vx: 0, vy: 0, goal: null, maxSpeed: 0, arrive: true,
		face: 1, flip: 1, phase: 0, speed: 0, air: 0, airV: 0, airBlend: 0, landed: false, squash: 0,
		pose: { ...BASE }, posture: 'stand', action: null, queue: [], budget: 0, recent: [],
		visible: false, time: 0, seed: rand(0, 100), reactCool: 0,
		blink: 1, blinkT: 0, blinkAt: 2, look: { x: 0, y: 0 }, lookGoal: { x: 0, y: 0 }, lookAt: 0, pupil: 0.45, earTwitch: 0,
		head: { x: 0, y: 0 }, zs: [], zAt: 0,
	};
	let clock = performance.now() / 1000, last = performance.now(), timer = 0;

	// ---------------------------------------------------------------- rendering
	function gait() {
		const ph = cat.phase * TAU;
		const amp = clamp(cat.speed / (S * 0.6), 0, 1) * (1 - cat.airBlend);
		const run = clamp((cat.speed - S * 1.1) / (S * 0.8), 0, 1);
		const A = lerp(0.42, 0.75, run) * amp;
		// Footfall offsets (fraction of cycle): lateral walk → gallop.
		const f = (walk, gallop) => {
			const p = ph + lerp(walk, gallop, run) * TAU;
			return { a: A * Math.sin(p), lift: Math.max(0, Math.cos(p)) * amp * lerp(0.6, 1, run) };
		};
		return {
			NH: f(0, 0), FH: f(0.5, 0.1), NF: f(0.25, 0.5), FF: f(0.75, 0.6),
			bob: amp * 0.012 * Math.cos(2 * ph),
			pitch: Math.sin(ph) * 0.1 * run * amp,
		};
	}

	function leg(sp, paw, jx, jy, a, gaitLift, raise, plant) {
		const c = Math.cos(a);
		const reach = c > 0.2 ? -jy / c : LN; // length that puts the paw on the ground
		const planted = plant * (1 - clamp(raise, 0, 1));
		const len = Math.max(0.3 * LN, lerp(LN, clamp(reach, 0.38 * LN, 1.35 * LN), planted) - (gaitLift + raise) * 0.3 * LN);
		spr(sp, jx, jy, -a, 1, len / LN, 0, -0.8 * LEG_RY);
		spr(paw, jx + Math.sin(a) * len, jy + c * len - 0.01 * S);
	}

	function drawTail(bx, by, P, t) {
		const n = 9, seg = 0.052 * S, puff = 1 + P.tailPuff * 0.45, pts = [];
		let x = bx, y = by;
		for (let i = 0; i < n; i++) {
			const a = P.tailA + i * P.tailCurl + P.tailWag * Math.sin(t * 2.2 - i * 0.5) * (0.3 + i / n);
			x += Math.cos(a) * seg;
			y = Math.min(y + Math.sin(a) * seg, -0.035 * S); // rests on the floor instead of sinking
			pts.push([x, y, a]);
		}
		for (let i = n - 1; i >= 0; i--) {
			const [px, py, a] = pts[i], r = (1 - (i / n) * 0.25) * puff;
			spr(SP.tail[i % 3], px, py, a - PI, r, r);
		}
	}

	function drawEye(x, y, rx, ry, open) {
		const h = ry * open;
		if (open < 0.12) { // closed: soft lash curve
			ctx.strokeStyle = 'rgba(80,52,36,.85)';
			ctx.lineWidth = 1.6 * K;
			ctx.beginPath();
			ctx.ellipse(x, y + ry * 0.1, rx * 0.9, ry * 0.35, 0, 0.15 * PI, 0.85 * PI);
			ctx.stroke();
			return;
		}
		ctx.save();
		ctx.beginPath();
		ctx.ellipse(x, y, rx, h, 0, 0, TAU);
		ctx.clip();
		const g = ctx.createRadialGradient(x - rx * 0.2, y - ry * 0.2, ry * 0.1, x, y, ry);
		g.addColorStop(0, '#f6b860');
		g.addColorStop(0.6, '#d07a22');
		g.addColorStop(1, '#6b3a0e');
		ctx.fillStyle = g;
		ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
		const px = x + cat.look.x * rx * 0.35, py = y + cat.look.y * ry * 0.3;
		ctx.fillStyle = '#140b06';
		ctx.beginPath();
		ctx.ellipse(px, py, rx * cat.pupil, ry * 0.8, 0, 0, TAU);
		ctx.fill();
		const lid = ctx.createLinearGradient(0, y - h, 0, y);
		lid.addColorStop(0, 'rgba(60,35,20,.55)');
		lid.addColorStop(1, 'rgba(60,35,20,0)');
		ctx.fillStyle = lid;
		ctx.fillRect(x - rx, y - h, rx * 2, h);
		ctx.fillStyle = 'rgba(255,255,255,.9)';
		ctx.beginPath();
		ctx.ellipse(px - rx * 0.3, py - ry * 0.35, rx * 0.22, ry * 0.17, 0, 0, TAU);
		ctx.fill();
		ctx.restore();
		ctx.strokeStyle = 'rgba(55,35,25,.9)';
		ctx.lineWidth = 1.3 * K;
		ctx.beginPath();
		ctx.ellipse(x, y, rx, h, 0, 0, TAU);
		ctx.stroke();
	}

	function drawFace(r, lon0, P) {
		const open = P.eyeOpen * cat.blink;
		// Persian flat face: puffy light muzzle, high short nose, big round copper eyes.
		const mx = Math.sin(lon0) * r * 0.78, my = r * 0.28;
		const mg = ctx.createRadialGradient(mx, my, 0, mx, my, r * 0.42);
		mg.addColorStop(0, furColor(1, 1, 0.75));
		mg.addColorStop(1, furColor(1, 1, 0));
		ctx.fillStyle = mg;
		ctx.beginPath();
		ctx.arc(mx, my, r * 0.42, 0, TAU);
		ctx.fill();

		for (const side of [-1, 1]) {
			const lon = lon0 + side * 0.55, cw = Math.cos(lon);
			if (cw > 0.12) drawEye(Math.sin(lon) * r * 0.82, -r * 0.08, r * 0.2 * cw, r * 0.2, open);
		}

		const nx = Math.sin(lon0) * r * 0.9, ny = r * 0.17, nw = r * 0.085;
		ctx.fillStyle = '#c98a84';
		ctx.beginPath();
		ctx.moveTo(nx - nw, ny - nw * 0.5);
		ctx.quadraticCurveTo(nx, ny - nw * 0.9, nx + nw, ny - nw * 0.5);
		ctx.quadraticCurveTo(nx + nw * 0.3, ny + nw * 0.6, nx, ny + nw * 0.7);
		ctx.quadraticCurveTo(nx - nw * 0.3, ny + nw * 0.6, nx - nw, ny - nw * 0.5);
		ctx.fill();

		const mo = P.mouth;
		if (mo > 0.05) { // open mouth: yawn
			const cy = ny + r * 0.14 + mo * r * 0.14, rw = r * (0.06 + mo * 0.1), rh = r * mo * 0.2;
			ctx.fillStyle = '#5a1f22';
			ctx.beginPath(); ctx.ellipse(nx, cy, rw, rh, 0, 0, TAU); ctx.fill();
			ctx.fillStyle = '#e48a90';
			ctx.beginPath(); ctx.ellipse(nx, cy + rh * 0.45, rw * 0.7, rh * 0.45, 0, 0, TAU); ctx.fill();
			ctx.fillStyle = '#fffaf2';
			for (const s of [-1, 1]) {
				ctx.beginPath();
				ctx.moveTo(nx + s * rw * 0.75, cy - rh * 0.7);
				ctx.lineTo(nx + s * rw * 0.5, cy - rh * 0.7);
				ctx.lineTo(nx + s * rw * 0.62, cy - rh * 0.25);
				ctx.fill();
			}
		} else {
			ctx.strokeStyle = 'rgba(110,70,60,.8)';
			ctx.lineWidth = 1.1 * K;
			ctx.beginPath();
			ctx.moveTo(nx, ny + nw * 0.7);
			ctx.lineTo(nx, ny + r * 0.1);
			ctx.quadraticCurveTo(nx - r * 0.05, ny + r * 0.17, nx - r * 0.1, ny + r * 0.12);
			ctx.moveTo(nx, ny + r * 0.1);
			ctx.quadraticCurveTo(nx + r * 0.05, ny + r * 0.17, nx + r * 0.1, ny + r * 0.12);
			ctx.stroke();
		}

		ctx.strokeStyle = 'rgba(255,253,245,.6)';
		ctx.lineWidth = 0.8 * K;
		for (const side of [-1, 1]) {
			const lon = lon0 + side * 0.4, cw = Math.cos(lon);
			if (cw < 0) continue;
			const bx = Math.sin(lon) * r * 0.72, by = r * 0.27, L = r * 1.1 * (0.4 + 0.6 * cw);
			for (let k = -1; k <= 1; k++) {
				ctx.beginPath();
				ctx.moveTo(bx, by + k * r * 0.03);
				ctx.quadraticCurveTo(bx + side * L * 0.5, by + k * r * 0.08 - r * 0.05, bx + side * L, by + k * r * 0.18 + r * 0.06);
				ctx.stroke();
			}
		}
	}

	function drawHead(hx, hy, P, t) {
		const r = 0.185 * S;
		const turn = P.faceTurn * clamp(Math.abs(cat.flip) * 1.4 - 0.2, 0, 1); // face the viewer mid-turn
		const lon0 = turn * 0.85;
		ctx.save();
		ctx.translate(hx, hy);
		ctx.rotate(P.headTilt);
		for (const [side, sp] of [[-1, SP.earF], [1, SP.earN]]) {
			const lon = lon0 + side * 0.85;
			const twitch = side > 0 ? cat.earTwitch * Math.sin(t * 40) * 0.25 : 0;
			const rot = side * (0.38 + P.earBack * 0.55) + Math.sin(lon) * 0.2 + twitch;
			spr(sp, Math.sin(lon) * r * 0.72, -r * 0.8 + P.earBack * r * 0.12, rot, Math.max(0.45, Math.cos(lon * 0.8)), 1);
		}
		spr(SP.head, 0, 0);
		drawFace(r, lon0, P);
		ctx.restore();
	}

	function drawCat(P, t) {
		const g = gait();
		const pitch = P.pitch + g.pitch, sp = Math.sin(pitch), cp = Math.cos(pitch), st = P.stretch;
		const hx = -0.2 * S, hy = (-0.26 + P.crouch + g.bob + cat.squash * 0.05) * S;
		const at = (dx, dy) => [hx + (dx * cp - dy * sp) * S, hy + (dx * sp + dy * cp) * S];
		const [sx, sy] = at(0.38 * st, 0);
		const [bx, by] = at(0.19 * st, -0.03);
		const [cx, cy] = at(0.36 * st, -0.03);
		const [qx, qy] = at(0, -0.04);
		const [nx, ny] = at(0.54 * st, -0.2);
		const [tx, ty] = at(-0.12, -0.07);
		const sleeping = cat.action && cat.action.sleeping;
		const breathe = 1 + Math.sin(t * (sleeping ? 1.6 : 2.6)) * (sleeping ? 0.028 : 0.012);
		const j = 0.03 * S;

		drawTail(tx, ty, P, t);
		leg(SP.legF, SP.pawF, hx + 0.035 * S, hy + j, P.lFH + g.FH.a, g.FH.lift, 0, P.plant);
		leg(SP.legF, SP.pawF, sx - 0.03 * S, sy + j, P.lFF + g.FF.a, g.FF.lift, 0, P.plant);
		spr(SP.body, bx, by, pitch, st, breathe);
		spr(SP.haunch, qx, qy, pitch * 0.5);
		const hindN = () => leg(SP.legN, SP.pawN, hx, hy + j, P.lNH + g.NH.a, g.NH.lift, P.liftNH, P.plant);
		if (P.liftNH < 0.5) hindN();
		spr(SP.chest, cx, cy, pitch * 0.6, 1, breathe);
		if (P.liftNH >= 0.5) hindN(); // raised to scratch: in front of the chest
		leg(SP.legN, SP.pawN, sx, sy + j, P.lNF + g.NF.a, g.NF.lift, P.liftNF, P.plant);

		const headX = nx + P.headX * S, headY = ny + P.headY * S + g.bob * S * 0.6;
		drawHead(headX, headY, P, t);
		cat.head.x = cat.x + headX * cat.flip;
		cat.head.y = cat.y - cat.air + headY;
	}

	function render() {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!cat.visible) return;
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

		const sh = 1 / (1 + cat.air / (S * 0.4)); // soft contact shadow, shrinks mid-jump
		ctx.save();
		ctx.translate(cat.x + 0.02 * S * cat.flip, cat.y);
		ctx.scale(1, 0.14);
		const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.45 * S * sh);
		rg.addColorStop(0, `rgba(0,0,0,${0.32 * sh})`);
		rg.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = rg;
		ctx.beginPath();
		ctx.arc(0, 0, 0.45 * S * sh, 0, TAU);
		ctx.fill();
		ctx.restore();

		ctx.save();
		ctx.translate(cat.x, cat.y - cat.air);
		ctx.scale(cat.flip, 1);
		drawCat(cat.pose, cat.time);
		ctx.restore();

		for (const z of cat.zs) {
			ctx.globalAlpha = Math.max(0, 1 - z.age / 3);
			ctx.fillStyle = '#b9bdd6';
			ctx.font = `600 ${(11 + z.age * 7) * K}px system-ui, sans-serif`;
			ctx.fillText('z', z.x + Math.sin(z.age * 2) * 6 * K, z.y - z.age * S * 0.13);
		}
		ctx.globalAlpha = 1;
	}

	// ---------------------------------------------------------------- movement
	const bounds = () => ({ x0: S * 0.55, x1: Math.max(S * 0.55, W - S * 0.55), y0: Math.min(H - 12, S * 0.8 + 30), y1: H - 12 });
	const clampX = x => { const b = bounds(); return clamp(x, b.x0, b.x1); };
	const clampY = y => { const b = bounds(); return clamp(y, b.y0, b.y1); };
	function spot(minD = S * 0.6, maxD = S * 4) {
		const b = bounds();
		let p = null;
		for (let i = 0; i < 12; i++) {
			p = { x: rand(b.x0, b.x1), y: clampY(cat.y + rand(-1, 1) * S * 1.3) };
			const d = Math.hypot(p.x - cat.x, p.y - cat.y);
			if (d >= minD && d <= maxD) break;
		}
		return p;
	}

	function moveTo(x, y, speed, arrive = true) {
		cat.goal = { x, y };
		cat.maxSpeed = speed;
		cat.arrive = arrive;
	}

	function jumpTo(x, y, height) {
		const v0 = Math.sqrt(2 * G * height), T = (2 * v0) / G;
		cat.airV = v0;
		cat.air = 0.01;
		moveTo(x, y, Math.hypot(x - cat.x, y - cat.y) / T, false);
	}

	function physics(dt) {
		if (cat.goal) {
			const dx = cat.goal.x - cat.x, dy = cat.goal.y - cat.y, d = Math.hypot(dx, dy);
			const sp = cat.arrive ? Math.min(cat.maxSpeed, d * 2.2) : cat.maxSpeed;
			if (d < Math.max(2, sp * dt)) {
				cat.x = cat.goal.x; cat.y = cat.goal.y; cat.goal = null;
			} else {
				const wob = cat.air ? 0 : Math.sin(cat.time * 0.9 + cat.seed) * 0.25; // lazy meander
				const c = Math.cos(wob), s = Math.sin(wob), ux = dx / d, uy = dy / d;
				const k = cat.air ? 1 : 1 - Math.exp(-5 * dt);
				cat.vx += ((ux * c - uy * s) * sp - cat.vx) * k;
				cat.vy += ((ux * s + uy * c) * sp - cat.vy) * k;
			}
		}
		if (!cat.goal) {
			cat.vx = damp(cat.vx, 0, 7, dt);
			cat.vy = damp(cat.vy, 0, 7, dt);
		}
		cat.x += cat.vx * dt;
		cat.y += cat.vy * dt;
		cat.speed = cat.air ? 0 : Math.hypot(cat.vx, cat.vy);
		cat.phase += (cat.speed * dt) / (S * 0.62);
		if (Math.abs(cat.vx) > S * 0.06) cat.face = Math.sign(cat.vx);
		cat.flip = damp(cat.flip, cat.face, 10, dt); // squash through 0 reads as turning around

		if (cat.air > 0) {
			cat.air += cat.airV * dt;
			cat.airV -= G * dt;
			if (cat.air <= 0) {
				cat.air = 0; cat.airV = 0; cat.squash = 1; cat.goal = null;
			}
		}
		cat.airBlend = damp(cat.airBlend, cat.air > 0 ? 1 : 0, 14, dt);
		cat.squash = damp(cat.squash, 0, 6, dt);
	}

	// ---------------------------------------------------------------- actions
	// Fields: posture, pose (overlay), keys [[t, overlay]...], dur | until(a), tick(a, dt, target),
	// rate (pose easing), interruptible (default true), onEnd(a), sleeping, playful.
	function leap(getTarget, height, extra = {}) {
		return {
			posture: 'stand', rate: 12, interruptible: false, wind: 0.35, ...extra,
			tick(a, dt, T) {
				if (!a.jumped) {
					a.p = a.p || getTarget();
					cat.face = Math.sign(a.p.x - cat.x) || cat.face;
					Object.assign(T, CROUCH);
					if (a.wiggle) T.pitch += Math.sin(cat.time * 22) * 0.035; // butt wiggle
					if (a.t > a.wind) { a.jumped = true; jumpTo(a.p.x, a.p.y, height); }
				} else if (cat.air === 0 && a.landT === undefined) a.landT = a.t;
			},
			until: a => a.landT !== undefined && a.t - a.landT > 0.3,
		};
	}

	const ACT = {
		enter() {
			const b = bounds();
			moveTo(rand(b.x0 + S, b.x1 - S), cat.y, S * 0.5);
			return { posture: 'stand', interruptible: false, until: () => !cat.goal };
		},
		leave() {
			const side = cat.x < W / 2 ? -1 : 1;
			moveTo(side < 0 ? -S * 0.9 : W + S * 0.9, cat.y + rand(-0.5, 0.5) * S, S * rand(0.5, 0.7));
			return { posture: 'stand', interruptible: false, until: () => !cat.goal, onEnd: hide };
		},
		wander() {
			return {
				posture: 'stand', pose: chance(0.3) ? SNIFF : {}, p: spot(), pause: 0, speed: S * rand(0.38, 0.6),
				tick(a, dt, T) {
					if (a.pause > 0) { // stop and look around mid-walk
						a.pause -= dt;
						cat.goal = null;
						T.faceTurn = a.pft;
						T.headY = -0.02;
						T.headTilt = a.ptilt;
						return;
					}
					if (chance(dt * 0.12)) { a.pause = rand(0.7, 1.8); a.pft = rand(0, 0.5); a.ptilt = rand(-0.2, 0.2); }
					moveTo(a.p.x, a.p.y, a.speed);
				},
				until: a => a.pause <= 0 && Math.hypot(a.p.x - cat.x, a.p.y - cat.y) < 4,
			};
		},
		idle: () => ({ posture: 'stand', dur: rand(1.5, 4) }),
		lookAround: () => ({
			posture: chance(0.5) ? 'sit' : 'stand', dur: rand(3, 6), next: 0,
			tick(a, dt, T) {
				if ((a.next -= dt) <= 0) {
					a.next = rand(0.6, 1.6);
					a.ft = rand(0, 1); a.tilt = rand(-0.25, 0.25); a.hy = rand(-0.03, 0.03);
					if (chance(0.25)) cat.earTwitch = 1;
					if (chance(0.15)) cat.face *= -1;
				}
				T.faceTurn = a.ft; T.headTilt += a.tilt; T.headY += a.hy;
			},
		}),
		sit: () => ({
			posture: 'sit', dur: rand(4, 10), next: 1, ft: 0.45,
			tick(a, dt, T) {
				if ((a.next -= dt) <= 0) { a.next = rand(1.5, 4); a.ft = chance(0.4) ? 0.05 : rand(0.3, 0.7); }
				T.faceTurn = a.ft; // sometimes looks right at you
				T.tailWag = 0.1;
			},
		}),
		groom: () => ({
			posture: 'sit', dur: rand(4, 7),
			pose: { liftNF: 1, lNF: 2.3, headY: 0.05, headX: -0.02, headTilt: 0.28, faceTurn: 0.35, eyeOpen: 0.35 },
			tick(a, dt, T) {
				const s = Math.sin(cat.time * 8);
				T.headTilt += s * 0.1; T.lNF += s * 0.12; T.headY += Math.max(0, s) * 0.015;
			},
		}),
		scratch: () => ({
			posture: 'sit', dur: rand(2, 3.5),
			pose: { liftNH: 1, lNH: 2.2, headTilt: 0.35, headX: -0.05, headY: 0.04, faceTurn: 0.25, eyeOpen: 0.45, earBack: 0.5 },
			tick(a, dt, T) {
				T.lNH += Math.sin(cat.time * 24) * 0.28;
				T.headTilt += Math.sin(cat.time * 24) * 0.03;
			},
		}),
		yawn: () => ({
			posture: cat.posture, dur: 2.6,
			keys: [
				[0, {}],
				[0.7, { mouth: 1, eyeOpen: 0.1, headTilt: -0.4, headY: -0.03, earBack: 0.6 }],
				[1.7, { mouth: 1, eyeOpen: 0.05, headTilt: -0.45, earBack: 0.7 }],
				[2.6, {}],
			],
		}),
		stretch: () => {
			const bow = { pitch: 0.38, crouch: -0.04, lNF: 1.05, lFF: 0.95, stretch: 1.1, tailA: PI + 1.1, tailCurl: 0.02, eyeOpen: 0.3, headY: 0.1, headX: 0.06, headTilt: -0.15, mouth: 0.2 };
			return { posture: 'stand', dur: 3, keys: [[0, {}], [0.8, bow], [2.1, { ...bow, pitch: 0.4, stretch: 1.12, eyeOpen: 0.2, mouth: 0.35 }], [3, {}]] };
		},
		sleep: () => ({
			posture: 'lie', dur: rand(14, 40), rate: 2.5, sleeping: true,
			pose: { eyeOpen: 0, headY: 0.14, headTilt: 0.3, faceTurn: 0.25, tailWag: 0 },
			onEnd: () => cat.queue.unshift('yawn', 'stretch'),
		}),
		zoomies: () => ({
			posture: 'stand', n: 3 + Math.floor(Math.random() * 3), pose: { earBack: 0.6, tailA: PI + 0.8, tailPuff: 0.3 },
			tick(a) {
				if (!cat.goal && a.n-- > 0) { const p = spot(S * 1.5, S * 6); moveTo(p.x, p.y, S * rand(2, 2.8)); }
			},
			until: a => a.n < 0 && !cat.goal,
		}),
		leap: () => leap(() => spot(S, S * 2.2), S * rand(0.3, 0.55)),
		pounce: () => {
			cat.face = Math.sign(mouse.x - cat.x) || cat.face;
			cat.pupil = 0.75;
			return leap(() => ({ x: clampX(mouse.x - cat.face * S * 0.42), y: clampY(mouse.y + S * 0.05) }), S * 0.45, {
				wind: rand(0.5, 1.1), wiggle: true,
				onEnd: () => cat.queue.unshift(weighted({ sit: 2, lookAround: 1.5, groom: 0.7 })),
			});
		},
		startle: () => ({
			posture: 'stand', interruptible: false, pose: { earBack: 1, tailPuff: 1, tailA: PI + 1.2, tailCurl: 0.05, eyeOpen: 1.15 },
			tick(a) {
				if (!a.jumped) {
					a.jumped = true;
					cat.pupil = 0.85;
					jumpTo(clampX(cat.x + (Math.sign(cat.x - mouse.x) || 1) * S * 0.5), cat.y, S * 0.35);
				}
			},
			until: a => a.jumped && cat.air === 0 && a.t > 0.3,
			onEnd: () => cat.queue.unshift('flee'),
		}),
		flee: () => {
			const away = Math.sign(cat.x - mouse.x) || 1;
			moveTo(clampX(cat.x + away * S * rand(2, 4)), clampY(cat.y + rand(-1, 1) * S), S * 2.4);
			return { posture: 'stand', pose: { earBack: 0.8, tailPuff: 0.6, tailA: PI + 0.9 }, until: () => !cat.goal };
		},
		chase: () => ({
			posture: 'stand', dur: rand(6, 11), playful: true, pose: { earBack: -0.2, tailA: PI + 0.55, tailWag: 0.25, faceTurn: 0.85 },
			tick(a) {
				cat.pupil = 0.7;
				const fresh = clock - mouse.lastMove < 0.6;
				moveTo(clampX(mouse.x - Math.sign(mouse.x - cat.x) * S * 0.55), clampY(mouse.y + S * 0.05), S * (fresh ? 2 : 0.6));
				if (a.t > 1 && clock - mouse.lastMove < 1.5 && Math.hypot(mouse.x - cat.x, mouse.y - cat.y + 0.3 * S) < S * 0.8) a.pounce = true;
			},
			until: a => a.pounce || clock - mouse.lastMove > 2.5,
			onEnd: a => { cat.goal = null; cat.queue.unshift(a.pounce ? 'pounce' : 'sit'); },
		}),
	};

	function start(name) {
		const a = ACT[name]();
		a.name = name;
		a.t = 0;
		cat.action = a;
		cat.posture = a.posture || 'stand';
		cat.recent = [name, ...cat.recent].slice(0, 3);
	}

	function next() {
		let name = cat.queue.shift();
		if (!name) {
			if (--cat.budget <= 0) name = 'leave';
			else {
				const w = { wander: 3, idle: 1, lookAround: 1.3, sit: 1.3, groom: 0.8, scratch: 0.45, yawn: 0.55, stretch: 0.45, sleep: 0.4, zoomies: 0.25, leap: 0.35 };
				for (const r of cat.recent) if (w[r]) w[r] *= 0.2; // avoid repeating itself
				name = weighted(w);
			}
		}
		start(name);
	}

	function targetPose(a, dt) {
		const T = Object.assign({}, BASE, POSTURE[a.posture || 'stand'], a.pose);
		if (a.keys) {
			let i = 0;
			while (i < a.keys.length - 2 && a.t >= a.keys[i + 1][0]) i++;
			const [t0, k0] = a.keys[i], [t1, k1] = a.keys[i + 1];
			const u = smooth(clamp((a.t - t0) / (t1 - t0), 0, 1));
			for (const k of new Set([...Object.keys(k0), ...Object.keys(k1)])) T[k] = lerp(k0[k] ?? T[k], k1[k] ?? T[k], u);
		}
		if (a.tick) a.tick(a, dt, T);
		if (cat.air > 0) Object.assign(T, AIR);
		return T;
	}

	// ---------------------------------------------------------------- mouse & life details
	function mouseReact(dt) {
		mouse.energy *= Math.exp(-1.3 * dt);
		if (clock - mouse.lastMove > 0.25) mouse.speed = 0;
		if (!CFG.mouseInteraction) return;
		const a = cat.action;
		if (a.interruptible === false) return;
		const recent = clock - mouse.lastMove < 0.25;
		const dx = mouse.x - cat.x, d = Math.hypot(dx, mouse.y - (cat.y - 0.3 * S));

		if (a.sleeping) { // a fidgety pointer nearby wakes it up
			if (recent && d < S * 1.6) {
				cat.earTwitch = 1;
				a.disturb = (a.disturb || 0) + dt;
				if (a.disturb > 0.8) { start('yawn'); cat.queue = ['stretch', chance(0.5) ? 'chase' : 'sit']; }
			}
			return;
		}
		if (clock < cat.reactCool) return;
		if (recent && d < S * 0.75 && mouse.speed > S * 3.5) { // pointer whizzes past
			cat.reactCool = clock + rand(5, 9);
			start(chance(0.4) ? 'startle' : 'pounce');
			return;
		}
		if (!a.playful && mouse.energy > S * 2.6 && d < S * 5 && chance(dt * 1.5)) { // pointer is "playing"
			cat.reactCool = clock + rand(8, 16);
			start('chase');
			return;
		}
		if (['sit', 'idle', 'lookAround'].includes(a.name) && recent && d < S * 3 && Math.sign(dx) !== cat.face && chance(dt * 2)) {
			cat.face = Math.sign(dx);
		}
	}

	function details(dt) {
		if ((cat.blinkAt -= dt) <= 0) { cat.blinkAt = chance(0.2) ? 0.3 : rand(2, 6); cat.blinkT = 0.16; }
		cat.blinkT -= dt;
		cat.blink = cat.blinkT > 0 ? Math.abs(cat.blinkT / 0.08 - 1) : 1;

		const watching = CFG.mouseInteraction && clock - mouse.lastMove < 3 &&
			Math.hypot(mouse.x - cat.head.x, mouse.y - cat.head.y) < S * 7;
		if (watching) {
			cat.lookGoal.x = clamp(((mouse.x - cat.head.x) * Math.sign(cat.flip || 1)) / (S * 1.5), -1, 1);
			cat.lookGoal.y = clamp((mouse.y - cat.head.y) / (S * 1.5), -1, 1);
		} else if ((cat.lookAt -= dt) <= 0) { // idle saccades
			cat.lookAt = rand(0.8, 3);
			cat.lookGoal.x = rand(-0.6, 0.8);
			cat.lookGoal.y = rand(-0.4, 0.4);
		}
		cat.look.x = damp(cat.look.x, cat.lookGoal.x, 12, dt);
		cat.look.y = damp(cat.look.y, cat.lookGoal.y, 12, dt);
		cat.pupil = damp(cat.pupil, 0.45, 1.2, dt);
		if (chance(dt * 0.08)) cat.earTwitch = 1;
		cat.earTwitch = damp(cat.earTwitch, 0, 5, dt);

		if (cat.action.sleeping && (cat.zAt -= dt) <= 0) {
			cat.zAt = 1.6;
			cat.zs.push({ x: cat.head.x + cat.face * S * 0.08, y: cat.head.y - S * 0.12, age: 0 });
		}
		for (const z of cat.zs) z.age += dt;
		cat.zs = cat.zs.filter(z => z.age < 3);
	}

	// ---------------------------------------------------------------- loop & lifecycle
	function update(dt) {
		cat.time += dt;
		mouseReact(dt);
		const a = cat.action;
		a.t += dt;
		const T = targetPose(a, dt);
		const rate = a.rate || 7;
		for (const k in T) cat.pose[k] = damp(cat.pose[k], T[k], rate, dt);
		physics(dt);
		details(dt);
		if ((a.dur && a.t >= a.dur) || (a.until && a.until(a))) {
			if (a.onEnd) a.onEnd(a);
			if (cat.visible && cat.action === a) next();
		}
	}

	function frame(now) {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		clock = now / 1000;
		if (cat.visible) update(dt);
		render();
		if (cat.visible) requestAnimationFrame(frame);
	}

	function appear() {
		clearTimeout(timer);
		if (cat.visible) return;
		if (!canvas.isConnected) document.body.appendChild(canvas);
		resize();
		if (W < S * 2.5 || H < S * 1.2) { timer = setTimeout(appear, 30000); return; } // window too small
		const b = bounds(), side = chance(0.5) ? -1 : 1;
		Object.assign(cat, {
			x: side < 0 ? -S * 0.8 : W + S * 0.8, y: rand(b.y0, b.y1), vx: 0, vy: 0, goal: null,
			air: 0, airV: 0, face: -side, flip: -side, visible: true, queue: [], recent: [],
			budget: Math.round(rand(FREQ.visit[0], FREQ.visit[1])), pose: { ...BASE },
		});
		start('enter');
		last = performance.now();
		requestAnimationFrame(frame);
	}

	function hide() {
		cat.visible = false;
		cat.zs.length = 0;
		render();
		clearTimeout(timer);
		timer = setTimeout(appear, rand(FREQ.away[0], FREQ.away[1]) * 1000);
	}

	addEventListener('mousemove', e => {
		const now = performance.now() / 1000, dtm = Math.max(0.004, now - mouse.lastMove);
		const d = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y);
		if (dtm < 0.5) {
			mouse.energy += d;
			mouse.speed = lerp(mouse.speed, d / dtm, 0.5);
		}
		mouse.x = e.clientX;
		mouse.y = e.clientY;
		mouse.lastMove = now;
	}, { capture: true, passive: true });
	addEventListener('resize', () => { resize(); render(); });

	// Debug hooks (also used by preview.html).
	window.__persianCat = {
		summon: appear,
		play(name) {
			if (!cat.visible) appear();
			if (cat.x < 0 || cat.x > W) { cat.x = W / 2; cat.goal = null; }
			cat.queue = [];
			start(name);
		},
		cat,
	};
	timer = setTimeout(appear, (CFG.firstDelay ?? rand(8, 20)) * 1000);
})();
