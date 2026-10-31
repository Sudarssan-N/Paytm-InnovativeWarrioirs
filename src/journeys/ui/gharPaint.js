// Kal Ka Ghar, drawn. A block world from 16-pixel textures made here, no images.
// The world is 30 tiles wide and 16 high. Everything below works in tile units.
export const WORLD = Object.freeze({ cols: 30, rows: 16, ground: 12 });

export function viewFor(width, height) {
  const tile = Math.max(6, Math.floor(Math.min(width / WORLD.cols, height / WORLD.rows)));
  return { tile, ox: Math.round((width - tile * WORLD.cols) / 2), oy: Math.round(height - tile * WORLD.rows), width, height };
}

// Where a tap landed, in tile units.
export function tapToWorld(view, x, y) {
  return { x: (x - view.ox) / view.tile, y: (y - view.oy) / view.tile };
}

function seeded(seed) {
  let value = seed;
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
}

function tex(seed, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const rnd = seeded(seed);
  const dot = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
  const speck = (colors) => { for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) dot(x, y, colors[Math.floor(rnd() * colors.length)]); };
  paint({ ctx, rnd, dot, speck, rect: (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); } });
  return canvas;
}

const DIRT = ['#866043', '#79553a', '#8f6a4b', '#6d4c33'];
const STONE = ['#7f7f7f', '#747474', '#8a8a8a', '#6a6a6a'];

let cached = null;
function textures() {
  if (cached) return cached;
  const planks = (a, b, c) => ({ rect, speck }) => {
    speck([a, b, a, c]);
    for (const y of [3, 7, 11, 15]) rect(0, y, 16, 1, c);
    rect(5, 0, 1, 3, c); rect(12, 4, 1, 3, c); rect(3, 8, 1, 3, c); rect(10, 12, 1, 3, c);
  };
  const ore = (fleck, spark) => ({ speck, rect }) => {
    speck(STONE);
    for (const [x, y] of [[2, 3], [9, 2], [5, 7], [11, 8], [3, 11], [9, 12]]) {
      rect(x, y, 3, 2, fleck); rect(x + 1, y, 1, 1, spark);
    }
  };
  const block = (light, mid, dark, seed) => ({ speck, rect }) => {
    speck([mid, mid, light]);
    rect(0, 0, 16, 1, light); rect(0, 0, 1, 16, light); rect(0, 15, 16, 1, dark); rect(15, 0, 1, 16, dark);
    rect(3 + seed, 4, 4, 2, light); rect(9, 10, 3, 1, dark);
  };
  cached = {
    grass: tex(11, ({ speck, rect, rnd }) => {
      speck(DIRT);
      for (let x = 0; x < 16; x += 1) {
        const deep = 3 + Math.floor(rnd() * 3);
        for (let y = 0; y < deep; y += 1) rect(x, y, 1, 1, ['#6aaa3f', '#5d9a35', '#78b94a'][Math.floor(rnd() * 3)]);
      }
    }),
    dirt: tex(23, ({ speck }) => speck(DIRT)),
    stone: tex(37, ({ speck }) => speck(STONE)),
    cobble: tex(41, ({ speck, rect }) => {
      speck(STONE);
      for (const [x, y, w, h] of [[0, 3, 7, 1], [7, 0, 1, 4], [4, 7, 12, 1], [10, 3, 6, 1], [3, 4, 1, 4], [11, 8, 1, 4], [0, 12, 11, 1], [6, 12, 1, 4]]) rect(x, y, w, h, '#585858');
    }),
    bedrock: tex(43, ({ speck }) => speck(['#3b3b3b', '#2d2d2d', '#505050', '#1f1f1f'])),
    plank: tex(47, planks('#b58d55', '#a98149', '#7e5f33')),
    wall: tex(53, planks('#7e6339', '#745a32', '#574323')),
    log: tex(59, ({ speck, rect }) => { speck(['#5e4426', '#6b4e2c', '#4e381e']); for (const x of [3, 8, 12]) rect(x, 0, 1, 16, '#3f2d17'); }),
    leaves: tex(61, ({ speck, rnd, rect }) => { speck(['#3f8f2e', '#357f27', '#4c9f38', '#2b6b1f']); for (let i = 0; i < 12; i += 1) rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1, '#1f5216'); }),
    brick: tex(67, ({ speck, rect }) => {
      speck(['#a0523d', '#94493a', '#ab5c45']);
      for (const y of [3, 7, 11, 15]) rect(0, y, 16, 1, '#d8c7b4');
      for (const [x, y] of [[4, 0], [12, 0], [0, 4], [8, 4], [4, 8], [12, 8], [0, 12], [8, 12]]) rect(x, y, 1, 3, '#d8c7b4');
    }),
    glass: tex(71, ({ rect }) => {
      rect(0, 0, 16, 16, '#bfe6f5');
      rect(0, 0, 16, 1, '#6e4f2a'); rect(0, 15, 16, 1, '#6e4f2a'); rect(0, 0, 1, 16, '#6e4f2a'); rect(15, 0, 1, 16, '#6e4f2a');
      rect(7, 0, 2, 16, '#6e4f2a'); rect(0, 7, 16, 2, '#6e4f2a');
      rect(3, 3, 2, 1, '#ffffff'); rect(10, 10, 2, 1, '#ffffff');
    }),
    doorTop: tex(73, ({ rect }) => { rect(0, 0, 16, 16, '#8a5f2e'); rect(2, 2, 5, 6, '#bfe6f5'); rect(9, 2, 5, 6, '#bfe6f5'); rect(0, 15, 16, 1, '#5e3f1c'); }),
    doorBottom: tex(79, ({ rect }) => { rect(0, 0, 16, 16, '#8a5f2e'); rect(2, 2, 12, 5, '#7a5226'); rect(2, 9, 12, 5, '#7a5226'); rect(12, 5, 2, 2, '#e6d27a'); }),
    gold: tex(83, block('#fff27a', '#f2c531', '#b98a12', 0)),
    emerald: tex(89, block('#8ff2b4', '#2fc070', '#127a42', 1)),
    oreGold: tex(97, ore('#f2c531', '#fff27a')),
    oreSpent: tex(101, ore('#6a6a6a', '#8a8a8a')),
    wool: tex(103, ({ speck, rect }) => { speck(['#00baf2', '#00a8dc', '#14c5fa']); rect(0, 0, 16, 1, '#7fe0fb'); }),
    woolRed: tex(107, ({ speck }) => speck(['#cf2e21', '#b9281c', '#dc4336'])),
    white: tex(109, ({ speck }) => speck(['#f4f4f4', '#e8e8e8', '#fafafa'])),
  };
  return cached;
}

const PEOPLE = {
  ramesh: { skin: '#b97d55', hair: '#1f1712', shirt: '#2f6fc4', shirt2: '#2559a0', legs: '#2a3050', moustache: true },
  meena: { skin: '#c4895f', hair: '#17110d', shirt: '#c43d78', shirt2: '#9c2a5c', legs: '#c43d78', long: true, drape: '#f2c531' },
  anu: { skin: '#c4895f', hair: '#17110d', shirt: '#f2f2f2', shirt2: '#d8d8d8', legs: '#1f3c78', plaits: true, bag: '#d3543c' },
  amma: { skin: '#a8734e', hair: '#d9d9d9', shirt: '#6f9a7c', shirt2: '#587d63', legs: '#6f9a7c', long: true, drape: '#efe7d0' },
  trader: { skin: '#b97d55', hair: '#2a211c', shirt: '#0f5aa8', shirt2: '#0b4784', legs: '#262b3d', cap: '#00baf2' },
  cousin: { skin: '#b97d55', hair: '#2a211c', shirt: '#e08a3c', shirt2: '#bf6f28', legs: '#3d3324', moustache: true },
  nurse: { skin: '#c4895f', hair: '#17110d', shirt: '#f4f4f4', shirt2: '#dcdcdc', legs: '#f4f4f4', cap: '#cf2e21' },
};

// A person stands on (x, feet) in tile units. One pixel here is a sixteenth of a tile.
function person(ctx, view, x, feet, kind, { t = 0, walk = false, facing = 1, scale = 1, alpha = 1, swing = 0 } = {}) {
  const look = PEOPLE[kind];
  const u = (view.tile / 16) * scale;
  const px = view.ox + x * view.tile;
  const py = view.oy + feet * view.tile;
  const rect = (rx, ry, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(px + rx * u), Math.round(py + ry * u), Math.ceil(w * u), Math.ceil(h * u)); };
  const stride = walk ? Math.round(Math.sin(t * 12) * 3) : 0;
  const idle = walk ? 0 : Math.round(Math.sin(t * 2 + x) * 0.5);
  ctx.save();
  ctx.globalAlpha = alpha;
  rect(-5, -1, 10, 1, 'rgba(0,0,0,.22)');
  if (look.long) {
    rect(-4, -12, 8, 12, look.legs);
    rect(-4, -2, 8, 2, look.shirt2);
  } else {
    rect(-4 + (facing > 0 ? stride : -stride) * 0.5, -10, 4, 10, look.legs);
    rect(0 - (facing > 0 ? stride : -stride) * 0.5, -10, 4, 10, look.legs);
    rect(-4 + (facing > 0 ? stride : -stride) * 0.5, -2, 4, 2, '#2a1d12');
    rect(0 - (facing > 0 ? stride : -stride) * 0.5, -2, 4, 2, '#2a1d12');
  }
  rect(-4, -21 + idle, 8, 11, look.shirt);
  rect(-4, -12 + idle, 8, 2, look.shirt2);
  if (look.drape) { rect(-4, -21 + idle, 3, 11, look.drape); rect(-1, -17 + idle, 3, 3, look.drape); }
  if (look.bag) rect(facing > 0 ? -7 : 4, -20 + idle, 3, 8, look.bag);
  const armLift = swing ? Math.round(Math.sin(swing * Math.PI * 6) * 3) : Math.round((walk ? -stride : 0) * 0.6);
  rect(facing > 0 ? 3 : -5, -21 + idle + armLift, 2, 9, look.shirt2);
  rect(facing > 0 ? 3 : -5, -13 + idle + armLift, 2, 2, look.skin);
  if (swing) {
    const hx = facing > 0 ? 5 : -9;
    rect(hx, -18 + armLift, 4, 1, '#d8d8d8');
    rect(hx + (facing > 0 ? 1 : 2), -18 + armLift, 1, 7, '#7e5f33');
  }
  const headTop = -29 + idle;
  rect(-4, headTop, 8, 8, look.skin);
  rect(-4, headTop, 8, 3, look.hair);
  rect(facing > 0 ? -4 : 2, headTop + 3, 2, 2, look.hair);
  const eye = facing > 0 ? 1 : -3;
  rect(eye, headTop + 4, 1, 1, '#ffffff');
  rect(eye + 1, headTop + 4, 1, 1, '#1f1712');
  if (look.moustache) rect(facing > 0 ? 0 : -3, headTop + 6, 3, 1, '#1f1712');
  if (look.long) rect(facing > 0 ? -5 : 4, headTop + 1, 1, 6, look.hair);
  if (look.plaits) { rect(-5, headTop + 2, 1, 7, look.hair); rect(4, headTop + 2, 1, 7, look.hair); }
  if (look.cap) { rect(-4, headTop - 1, 8, 2, look.cap); }
  ctx.restore();
}

function tileAt(ctx, view, img, x, y, w = 1, h = 1) {
  ctx.drawImage(img, view.ox + x * view.tile, view.oy + y * view.tile, Math.ceil(w * view.tile), Math.ceil(h * view.tile));
}

function nameTag(ctx, view, x, y, text, { size = 0.62, color = '#fff' } = {}) {
  if (!text) return;
  const px = view.ox + x * view.tile;
  const py = view.oy + y * view.tile;
  const font = Math.max(10, Math.round(view.tile * size));
  ctx.font = `700 ${font}px ui-monospace, Menlo, 'Noto Sans', sans-serif`;
  const width = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,.58)';
  ctx.fillRect(Math.round(px - width / 2), Math.round(py - font), Math.ceil(width), font + 5);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, px, py);
}

function sky(ctx, view, time, cycle) {
  const night = cycle == null ? 0 : (Math.sin(cycle) + 1) / 2;
  const blend = (a, b) => Math.round(a + (b - a) * night);
  const top = `rgb(${blend(92, 18)},${blend(160, 26)},${blend(232, 66)})`;
  const low = `rgb(${blend(174, 44)},${blend(216, 52)},${blend(246, 92)})`;
  const gradient = ctx.createLinearGradient(0, 0, 0, view.height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, low);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);
  const sunX = cycle == null ? 26 : ((cycle / (Math.PI * 2)) % 1) * 34 - 2;
  ctx.fillStyle = night > 0.55 ? '#e8ecf5' : '#ffe680';
  ctx.fillRect(view.ox + sunX * view.tile, view.oy + 1 * view.tile, view.tile * 1.6, view.tile * 1.6);
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  for (const [x, y, w] of [[3, 1.6, 5], [14, 0.8, 7], [22, 2.4, 4]]) {
    const drift = ((x + time * 0.25) % 34) - 2;
    ctx.fillRect(view.ox + drift * view.tile, view.oy + y * view.tile, view.tile * w, view.tile * 0.6);
    ctx.fillRect(view.ox + (drift + 1) * view.tile, view.oy + (y - 0.45) * view.tile, view.tile * (w - 2), view.tile * 0.5);
  }
}

function ground(ctx, view, T) {
  const from = Math.floor(-view.ox / view.tile) - 1;
  const to = Math.ceil((view.width - view.ox) / view.tile);
  for (let x = from; x <= to; x += 1) {
    tileAt(ctx, view, T.grass, x, WORLD.ground);
    tileAt(ctx, view, T.dirt, x, WORLD.ground + 1);
    tileAt(ctx, view, T.stone, x, WORLD.ground + 2);
    tileAt(ctx, view, T.stone, x, WORLD.ground + 3);
  }
}

function tree(ctx, view, T, x) {
  for (let y = 8; y < WORLD.ground; y += 1) tileAt(ctx, view, T.log, x, y);
  for (let lx = x - 2; lx <= x + 2; lx += 1) for (let ly = 6; ly <= 8; ly += 1) if (!(ly === 6 && Math.abs(lx - x) === 2)) tileAt(ctx, view, T.leaves, lx, ly);
}

function torch(ctx, view, x, y, lit, time) {
  const px = view.ox + (x + 0.44) * view.tile;
  const py = view.oy + (y + 0.3) * view.tile;
  ctx.fillStyle = '#6e4f2a';
  ctx.fillRect(px, py, view.tile * 0.14, view.tile * 0.55);
  if (lit) {
    ctx.fillStyle = 'rgba(255,214,120,.22)';
    ctx.fillRect(px - view.tile * 0.8, py - view.tile * 0.8, view.tile * 1.74, view.tile * 1.7);
    ctx.fillStyle = Math.sin(time * 9 + x) > 0 ? '#ffb02e' : '#ffd24d';
    ctx.fillRect(px - view.tile * 0.03, py - view.tile * 0.16, view.tile * 0.2, view.tile * 0.2);
  }
}

// A house from x to x + wide - 1, its roof a staircase of brick.
function house(ctx, view, T, x, wide, wallTop, { lit = true, time = 0, banner = false, bannerLabel = '' } = {}) {
  for (let cx = x; cx < x + wide; cx += 1) for (let cy = wallTop; cy < WORLD.ground; cy += 1) tileAt(ctx, view, T.wall, cx, cy);
  for (let cy = wallTop; cy < WORLD.ground; cy += 1) { tileAt(ctx, view, T.log, x, cy); tileAt(ctx, view, T.log, x + wide - 1, cy); }
  let rx = x - 1;
  let rw = wide + 2;
  let ry = wallTop - 1;
  while (rw > 2 && ry >= wallTop - 3) {
    for (let cx = rx; cx < rx + rw; cx += 1) tileAt(ctx, view, T.brick, cx, ry);
    rx += 1; rw -= 2; ry -= 1;
  }
  tileAt(ctx, view, T.doorTop, x + wide - 1, WORLD.ground - 2);
  tileAt(ctx, view, T.doorBottom, x + wide - 1, WORLD.ground - 1);
  tileAt(ctx, view, T.glass, x + 1, wallTop + 1);
  tileAt(ctx, view, T.glass, x + wide - 3, wallTop + 1);
  torch(ctx, view, x + Math.floor(wide / 2), wallTop + 1, lit, time);
  if (banner) {
    const bx = x + wide / 2;
    const by = wallTop - 3.3;
    ctx.fillStyle = 'rgba(47,192,112,.2)';
    ctx.fillRect(view.ox + (x - 1.4) * view.tile, view.oy + by * view.tile, (wide + 2.8) * view.tile, (WORLD.ground - by) * view.tile);
    tileAt(ctx, view, T.emerald, bx - 0.5, by - 0.6);
    nameTag(ctx, view, bx, by - 0.8, bannerLabel, { color: '#8ff2b4' });
  }
}

function pile(ctx, view, T, x, base, cols, gold, plan, { ghostPlan = false, maxRows = 9, fullBlocks } = {}) {
  const total = gold + plan;
  const count = Math.ceil(total);
  if (!count) return;
  const rows = Math.ceil((fullBlocks ?? count) / cols);
  const size = Math.min(1, maxRows / Math.max(rows, 1));
  for (let at = 0; at < count; at += 1) {
    const col = at % cols;
    const row = Math.floor(at / cols);
    const part = at === count - 1 && total < count ? total - (count - 1) : 1;
    const isGold = at < Math.ceil(gold);
    ctx.save();
    if (!isGold && ghostPlan) ctx.globalAlpha = 0.42;
    const bx = x + col * size;
    const by = base - (row + 1) * size + (1 - part) * size;
    tileAt(ctx, view, isGold ? T.gold : T.emerald, bx, by, size, size * part);
    ctx.restore();
  }
}

// Bills: a square, hungry mob. It hops when it eats.
function billsMob(ctx, view, x, time, hop, label) {
  const jump = hop > 0 ? Math.sin(hop * Math.PI) * 0.9 : Math.abs(Math.sin(time * 3)) * 0.08;
  const size = 1.3;
  const px = view.ox + (x - size / 2) * view.tile;
  const py = view.oy + (WORLD.ground - size - jump) * view.tile;
  const s = size * view.tile;
  ctx.fillStyle = '#c9352a';
  ctx.fillRect(px, py, s, s);
  ctx.fillStyle = '#9f261d';
  ctx.fillRect(px, py + s * 0.82, s, s * 0.18);
  ctx.fillStyle = '#fff';
  ctx.fillRect(px + s * 0.14, py + s * 0.2, s * 0.26, s * 0.24);
  ctx.fillRect(px + s * 0.58, py + s * 0.2, s * 0.26, s * 0.24);
  ctx.fillStyle = '#1b1210';
  ctx.fillRect(px + s * 0.14, py + s * 0.28, s * 0.13, s * 0.14);
  ctx.fillRect(px + s * 0.58, py + s * 0.28, s * 0.13, s * 0.14);
  const open = hop > 0 ? 0.26 : 0.1;
  ctx.fillStyle = '#1b1210';
  ctx.fillRect(px + s * 0.2, py + s * 0.56, s * 0.6, s * open);
  nameTag(ctx, view, x, WORLD.ground - size - jump - 0.25, label, { color: '#ffd2cd', size: 0.5 });
}

function arrow(ctx, view, x, y, time) {
  const bob = Math.sin(time * 5) * 0.2;
  const px = view.ox + x * view.tile;
  const py = view.oy + (y + bob) * view.tile;
  const u = view.tile / 8;
  ctx.fillStyle = '#ffe680';
  ctx.strokeStyle = '#1b1210';
  ctx.lineWidth = Math.max(1, u / 2);
  ctx.beginPath();
  ctx.moveTo(px - u * 2, py - u * 5);
  ctx.lineTo(px + u * 2, py - u * 5);
  ctx.lineTo(px + u * 2, py - u * 2);
  ctx.lineTo(px + u * 4, py - u * 2);
  ctx.lineTo(px, py + u * 2);
  ctx.lineTo(px - u * 4, py - u * 2);
  ctx.lineTo(px - u * 2, py - u * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function photoFrame(ctx, view, x, y) {
  const px = view.ox + x * view.tile;
  const py = view.oy + y * view.tile;
  const s = view.tile;
  ctx.fillStyle = '#3a2a16';
  ctx.fillRect(px, py, s, s * 1.1);
  ctx.fillStyle = '#e8dfc9';
  ctx.fillRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.9);
  ctx.fillStyle = '#b97d55';
  ctx.fillRect(px + s * 0.33, py + s * 0.24, s * 0.34, s * 0.3);
  ctx.fillStyle = '#1f1712';
  ctx.fillRect(px + s * 0.33, py + s * 0.2, s * 0.34, s * 0.12);
  ctx.fillStyle = '#2f6fc4';
  ctx.fillRect(px + s * 0.26, py + s * 0.56, s * 0.48, s * 0.4);
  ctx.fillStyle = '#f29a1f';
  for (let at = 0; at < 7; at += 1) ctx.fillRect(px + s * 0.08 * at + s * 0.12, py + s * (at === 3 ? 0.94 : 0.8 + Math.abs(3 - at) * -0.04), s * 0.1, s * 0.1);
}

function sign(ctx, view, T, x, letter, time, active) {
  tileAt(ctx, view, T.log, x - 0.12, WORLD.ground - 1, 0.24, 1);
  tileAt(ctx, view, T.plank, x - 1, WORLD.ground - 2.5, 2, 1.5);
  ctx.fillStyle = '#2a1d12';
  ctx.font = `800 ${Math.round(view.tile * 1.05)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(letter, view.ox + x * view.tile, view.oy + (WORLD.ground - 1.38) * view.tile);
  if (active) arrow(ctx, view, x, WORLD.ground - 3.4, time + x);
}

function particles(ctx, view, list, T) {
  for (const item of list) {
    if (item.delay > 0) continue;
    ctx.globalAlpha = Math.max(Math.min(item.life * 2, 1), 0);
    if (item.img) tileAt(ctx, view, T[item.img], item.x - 0.2, item.y - 0.2, 0.4, 0.4);
    else if (item.text) nameTag(ctx, view, item.x, item.y, item.text, { color: item.color || '#fff', size: 0.7 });
    ctx.globalAlpha = 1;
  }
}

const pedestal = (ctx, view, T, x, block, on, time) => {
  tileAt(ctx, view, T.cobble, x - 0.5, WORLD.ground - 0.4, 1, 0.4);
  const bob = on ? 0 : Math.sin(time * 3 + x) * 0.12;
  tileAt(ctx, view, T[block], x - 0.5, WORLD.ground - 2.2 + bob, 1, 1);
  if (on) {
    ctx.strokeStyle = '#fff27a';
    ctx.lineWidth = Math.max(2, view.tile / 8);
    ctx.strokeRect(view.ox + (x - 0.5) * view.tile, view.oy + (WORLD.ground - 2.2) * view.tile, view.tile, view.tile);
  }
};

function mob(ctx, view, T, item, g, s) {
  if (item.kind === 'bill') billsMob(ctx, view, item.x, g.time, 0, s.labels[item.label]);
  else if (item.kind === 'cousin') {
    person(ctx, view, item.x, WORLD.ground, 'cousin', { t: g.time, walk: true, facing: item.dir });
    nameTag(ctx, view, item.x, WORLD.ground - 2.05, s.labels.cousin, { color: '#ffc08a' });
  } else {
    person(ctx, view, item.x, WORLD.ground, 'nurse', { t: g.time, walk: true, facing: item.dir });
    tileAt(ctx, view, T.woolRed, item.x - 0.12, WORLD.ground - 1.28, 0.24, 0.5);
    nameTag(ctx, view, item.x, WORLD.ground - 2.05, s.labels.hospital, { color: '#ffb4ad' });
  }
}

function rain(ctx, view, time) {
  ctx.fillStyle = 'rgba(170,200,255,.55)';
  for (let at = 0; at < 90; at += 1) {
    const x = ((at * 37.7) % view.width);
    const y = ((at * 53.3 + time * 900) % view.height);
    ctx.fillRect(x, y, 2, Math.max(8, view.tile * 0.6));
  }
}

// One frame. `g` is the game's rules state; `s` holds its look: labels and blocks to show.
export function drawGhar(ctx, view, g, s) {
  const T = textures();
  ctx.imageSmoothingEnabled = false;
  const shaken = g.shake > 0 ? { ...view, ox: view.ox + Math.round(Math.sin(g.time * 70) * view.tile * 0.25) } : view;
  const dark = g.stage === 'storm' ? Math.PI * 1.5 : g.stage === 'hold' || g.stage === 'over' ? g.year * 0.9 + 4 : null;
  sky(ctx, shaken, g.time, dark);
  ground(ctx, shaken, T);
  tree(ctx, shaken, T, 3);
  tree(ctx, shaken, T, 7);
  house(ctx, shaken, T, 10, 9, 7, { lit: g.stage !== 'over' || g.outcome?.won, time: g.time, banner: g.term && g.stage !== 'over' && g.who === 'ramesh', bannerLabel: s.labels.termName });
  if (g.who === 'meena') photoFrame(ctx, shaken, 14, 7.5);
  person(ctx, shaken, 12, WORLD.ground, 'amma', { t: g.time, facing: 1 });
  if (g.who !== 'meena') person(ctx, shaken, 14, WORLD.ground, 'meena', { t: g.time, facing: 1 });
  const anuScale = Math.min(1, 0.72 + (g.age - 8) * 0.03);
  person(ctx, shaken, 16, WORLD.ground, 'anu', { t: g.time, facing: -1, scale: anuScale });
  nameTag(ctx, shaken, 12, WORLD.ground + 0.85, s.labels.amma);
  if (g.who !== 'meena') nameTag(ctx, shaken, 14, WORLD.ground + 0.85, s.labels.meena);
  nameTag(ctx, shaken, 16, WORLD.ground + 0.85, s.labels.anu);

  if (g.stage === 'earn') {
    for (const ore of g.ores) {
      for (let h = 0; h < ore.h; h += 1) tileAt(ctx, shaken, T.cobble, ore.x - 0.5, WORLD.ground - 1 - h);
      tileAt(ctx, shaken, T.oreGold, ore.x - 0.5, WORLD.ground - 1 - ore.h);
      arrow(ctx, shaken, ore.x, WORLD.ground - ore.h - 1.5, g.time + ore.x);
    }
  }
  if (g.stage === 'shop') {
    pedestal(ctx, shaken, T, 20.5, 'emerald', g.term, g.time);
    pedestal(ctx, shaken, T, 24.5, 'woolRed', g.health, g.time);
    nameTag(ctx, shaken, 20.5, WORLD.ground - 2.6, s.labels.termName, { color: '#8ff2b4' });
    nameTag(ctx, shaken, 24.5, WORLD.ground - 2.6, s.labels.healthName, { color: '#ffb4ad' });
    arrow(ctx, shaken, 28.6, WORLD.ground - 2, g.time);
  }
  if (g.stage === 'storm' || g.stage === 'hold' || g.stage === 'over') {
    const gold = Math.min(s.shownBlocks, s.todayBlocks);
    pile(ctx, shaken, T, 20, WORLD.ground, 5, gold, Math.max(s.shownBlocks - s.todayBlocks, 0), { maxRows: 6, fullBlocks: 25 });
  }

  for (const item of g.mobs) mob(ctx, shaken, T, item, g, s);
  if (g.stage !== 'over' || g.outcome?.won) {
    const fading = g.stage === 'storm' && g.stormT < 3 ? Math.max(1 - g.stormT / 2.4, 0) : null;
    if (fading != null) person(ctx, shaken, g.x, WORLD.ground, 'ramesh', { t: g.time, facing: g.facing, alpha: fading });
    if (g.stage !== 'storm' || g.stormT >= 3) {
      person(ctx, shaken, g.x, WORLD.ground - g.y, g.who, { t: g.time, walk: g.moving, facing: g.facing });
      nameTag(ctx, shaken, g.x, WORLD.ground - g.y - 2, s.labels[g.who], { color: '#ffe680' });
    }
  }
  particles(ctx, shaken, g.bits || [], T);
  if (g.stage === 'storm') {
    rain(ctx, view, g.time);
    if (Math.sin(g.time * 3.1) > 0.97) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, 0, view.width, view.height); }
  }
  if (g.stage === 'over' && !g.outcome?.won) { ctx.fillStyle = 'rgba(14,14,28,.45)'; ctx.fillRect(0, 0, view.width, view.height); }
}
