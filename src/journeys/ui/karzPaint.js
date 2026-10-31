// Everything Karz Yatra draws. No images, so it loads instantly on a slow phone and
// every sign can be in the customer's script. Pure canvas, called once a frame.
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const SKY = [
  { top: [255, 196, 140], low: [255, 232, 196] }, // dawn
  { top: [92, 190, 245], low: [205, 238, 252] }, // noon
  { top: [108, 170, 232], low: [255, 226, 186] }, // afternoon
  { top: [70, 60, 130], low: [255, 150, 112] }, // dusk
];
const WALLS = ['#f6c6b8', '#a8dfe0', '#f8dd8e', '#c9d4f2', '#f2b5c6', '#bfe6b8', '#f4cfa1', '#d8c4ee'];
const SIGNS = ['KIRANA', 'CHAI', 'UPI ✓', 'MEDICAL', 'TAILOR', 'SWEETS', 'MOBILE', 'SCAN & PAY'];

export function layout(width, height) {
  const roadTop = Math.round(height * 0.56);
  const roadHeight = Math.round(height * 0.36);
  const laneHeight = roadHeight / 3;
  return { width, height, roadTop, roadHeight, laneHeight, laneY: (lane) => roadTop + laneHeight * (lane + 0.5), playerX: Math.round(Math.min(width * 0.2, 190)) };
}

const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

export function drawSky(ctx, g, progress) {
  const span = progress * (SKY.length - 1);
  const at = Math.min(Math.floor(span), SKY.length - 2);
  const t = span - at;
  const sky = ctx.createLinearGradient(0, 0, 0, g.roadTop);
  sky.addColorStop(0, rgb(mix(SKY[at].top, SKY[at + 1].top, t)));
  sky.addColorStop(1, rgb(mix(SKY[at].low, SKY[at + 1].low, t)));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, g.width, g.roadTop);
  const sunX = g.width * (0.12 + progress * 0.76);
  const sunY = g.roadTop * (0.62 - Math.sin(progress * Math.PI) * 0.46);
  const halo = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 90);
  halo.addColorStop(0, 'rgba(255,245,200,.95)');
  halo.addColorStop(0.25, 'rgba(255,225,140,.55)');
  halo.addColorStop(1, 'rgba(255,225,140,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - 90, sunY - 90, 180, 180);
}

export function drawHills(ctx, g, view) {
  const base = g.roadTop - 40;
  for (const [factor, color, rise, step] of [[0.06, 'rgba(116,150,178,.55)', 76, 150], [0.12, 'rgba(86,132,134,.6)', 50, 110]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, g.roadTop);
    const shift = view * factor;
    const first = Math.floor(shift / step) - 1;
    for (let i = first; i * step - shift < g.width + step; i++) {
      ctx.lineTo(i * step - shift, base - hash(i * 3 + factor * 100) * rise);
    }
    ctx.lineTo(g.width, g.roadTop);
    ctx.closePath();
    ctx.fill();
  }
}

function building(ctx, x, ground, i) {
  const kind = hash(i * 7.3);
  const width = 58 + hash(i * 2.1) * 56;
  if (kind < 0.09) { // gopuram
    ctx.fillStyle = '#e8a06a';
    for (let level = 0; level < 5; level++) {
      const w = width - level * 11;
      ctx.fillRect(x + (width - w) / 2, ground - 22 * (level + 1), w, 22);
      ctx.fillStyle = level % 2 ? '#e8a06a' : '#d98f5c';
    }
    ctx.fillStyle = '#c9762f';
    ctx.fillRect(x + width / 2 - 3, ground - 124, 6, 14);
    return width;
  }
  if (kind < 0.16) { // dome
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(x + 6, ground - 58, width - 12, 58);
    ctx.fillStyle = '#7fc4b2';
    ctx.beginPath();
    ctx.arc(x + width / 2, ground - 58, (width - 18) / 2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#e7ecf1';
    ctx.fillRect(x, ground - 94, 6, 94);
    return width;
  }
  if (kind < 0.26) { // palms
    for (const [dx, tall] of [[8, 78], [34, 62]]) {
      ctx.strokeStyle = '#7a5a3c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + dx, ground);
      ctx.quadraticCurveTo(x + dx + 6, ground - tall / 2, x + dx + 2, ground - tall);
      ctx.stroke();
      ctx.fillStyle = '#3f9a63';
      for (let leaf = 0; leaf < 6; leaf++) {
        ctx.save();
        ctx.translate(x + dx + 2, ground - tall);
        ctx.rotate((leaf / 6) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(16, 0, 17, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    return 60;
  }
  const floors = 1 + Math.floor(hash(i * 5.7) * 4);
  const height = floors * 26 + 22;
  ctx.fillStyle = WALLS[Math.floor(hash(i * 1.9) * WALLS.length)];
  ctx.fillRect(x, ground - height, width, height);
  ctx.fillStyle = 'rgba(30,50,90,.32)';
  for (let f = 0; f < floors; f++) {
    for (let w = 0; w < Math.floor(width / 20); w++) ctx.fillRect(x + 7 + w * 20, ground - height + 9 + f * 26, 10, 13);
  }
  if (hash(i * 9.1) > 0.55) { // the black water tank on every Indian roof
    ctx.fillStyle = '#2b3242';
    ctx.fillRect(x + width - 26, ground - height - 15, 18, 15);
  }
  return width;
}

export function drawTown(ctx, g, view) {
  const shift = view * 0.32;
  const ground = g.roadTop - 16;
  const spacing = 104;
  const first = Math.floor(shift / spacing) - 1;
  for (let i = first; i * spacing - shift < g.width + spacing; i++) building(ctx, i * spacing - shift, ground, i);
}

export function drawStreet(ctx, g, view) {
  // shops along the far footpath
  const spacing = 236;
  const first = Math.floor(view / spacing) - 1;
  ctx.fillStyle = '#d7cfc0';
  ctx.fillRect(0, g.roadTop - 18, g.width, 18);
  for (let i = first; i * spacing - view < g.width + spacing; i++) {
    const x = i * spacing - view;
    if (hash(i * 4.4) < 0.3) continue;
    const y = g.roadTop - 16;
    const stripes = hash(i * 6.2) > 0.5 ? ['#d6453d', '#fff4e4'] : ['#0f8f8a', '#fff4e4'];
    ctx.fillStyle = '#6f5a48';
    ctx.fillRect(x + 4, y - 34, 4, 34);
    ctx.fillRect(x + 90, y - 34, 4, 34);
    ctx.fillStyle = '#fde8b0';
    ctx.fillRect(x + 8, y - 22, 82, 22);
    for (let s = 0; s < 7; s++) {
      ctx.fillStyle = stripes[s % 2];
      ctx.fillRect(x + s * 14, y - 42, 14, 12);
    }
    const sign = SIGNS[Math.floor(hash(i * 3.3) * SIGNS.length)];
    ctx.fillStyle = sign === 'SCAN & PAY' ? '#002970' : '#ffffff';
    roundRect(ctx, x + 12, y - 60, 74, 17, 4);
    ctx.fill();
    ctx.fillStyle = sign === 'SCAN & PAY' ? '#00baf2' : '#26324d';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sign, x + 49, y - 51);
  }
  // the road
  const road = ctx.createLinearGradient(0, g.roadTop, 0, g.roadTop + g.roadHeight);
  road.addColorStop(0, '#4a5268');
  road.addColorStop(1, '#384056');
  ctx.fillStyle = road;
  ctx.fillRect(0, g.roadTop, g.width, g.roadHeight);
  ctx.fillStyle = '#f1c04a';
  ctx.fillRect(0, g.roadTop, g.width, 3);
  ctx.fillRect(0, g.roadTop + g.roadHeight - 3, g.width, 3);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  const dash = 64;
  const offset = view % dash;
  for (const lane of [1, 2]) {
    const y = g.roadTop + g.laneHeight * lane - 1.5;
    for (let x = -offset; x < g.width; x += dash) ctx.fillRect(x, y, 34, 3);
  }
  // the near kerb and the ground below it
  ctx.fillStyle = '#7d8a5c';
  ctx.fillRect(0, g.roadTop + g.roadHeight, g.width, g.height - g.roadTop - g.roadHeight);
  ctx.fillStyle = '#c9c2b2';
  ctx.fillRect(0, g.roadTop + g.roadHeight, g.width, 7);
}

export function drawLamps(ctx, g, view) {
  const spacing = 340;
  const first = Math.floor(view / spacing) - 1;
  for (let i = first; i * spacing - view < g.width + spacing; i++) {
    const x = i * spacing - view + 120;
    const base = g.roadTop - 2;
    ctx.fillStyle = '#3c4557';
    ctx.fillRect(x, base - 86, 4, 86);
    ctx.fillRect(x, base - 86, 26, 3);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(x + 22, base - 83, 8, 4);
  }
}

export function drawAuto(ctx, x, y, { tilt = 0, wheel = 0, shield = false, time = 0 }) {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 18) * 0.8);
  ctx.rotate(tilt);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath();
  ctx.ellipse(-2, 25, 50, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = '#1f9d55';
  roundRect(ctx, -46, -6, 70, 26, 8);
  ctx.fill();
  ctx.fillStyle = '#f6c32f';
  roundRect(ctx, -46, -6, 70, 9, [8, 8, 0, 0]);
  ctx.fill();
  // nose
  ctx.fillStyle = '#1f9d55';
  ctx.beginPath();
  ctx.moveTo(24, -4);
  ctx.quadraticCurveTo(46, -2, 46, 18);
  ctx.lineTo(24, 20);
  ctx.closePath();
  ctx.fill();
  // canopy
  ctx.fillStyle = '#1c2436';
  ctx.beginPath();
  ctx.moveTo(-44, -7);
  ctx.quadraticCurveTo(-42, -38, -12, -38);
  ctx.lineTo(16, -38);
  ctx.quadraticCurveTo(34, -36, 36, -6);
  ctx.closePath();
  ctx.fill();
  // window and driver
  ctx.fillStyle = '#bfe6ff';
  ctx.beginPath();
  ctx.moveTo(4, -32);
  ctx.lineTo(16, -32);
  ctx.quadraticCurveTo(28, -30, 30, -8);
  ctx.lineTo(4, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8b5e3c';
  ctx.beginPath();
  ctx.arc(13, -20, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#26324d';
  ctx.fillRect(7, -14, 13, 7);
  ctx.fillStyle = '#fff6c9';
  ctx.beginPath();
  ctx.arc(43, 6, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // wheels
  for (const wx of [-30, 32]) {
    ctx.save();
    ctx.translate(wx, 20);
    ctx.rotate(wheel);
    ctx.fillStyle = '#141a26';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9aa6bd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();
  }
  if (shield) {
    ctx.strokeStyle = 'rgba(0,186,242,.9)';
    ctx.fillStyle = 'rgba(0,186,242,.16)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -6, 62 + Math.sin(time * 5) * 2, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPickup(ctx, item, x, y, time, money) {
  const bob = Math.sin(time * 4 + x * 0.01) * 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (item.kind === 'coin') {
    const spin = Math.abs(Math.cos(time * 5 + x * 0.02));
    ctx.fillStyle = '#d99a13';
    ctx.beginPath();
    ctx.ellipse(x, y + bob, 15 * (0.4 + spin * 0.6), 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath();
    ctx.ellipse(x, y + bob, 12 * (0.4 + spin * 0.6), 12, 0, 0, Math.PI * 2);
    ctx.fill();
    if (spin > 0.5) {
      ctx.fillStyle = '#8a5a00';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillText('₹', x, y + bob + 1);
    }
    return;
  }
  if (item.kind === 'scam') {
    const pulse = 1 + Math.sin(time * 9) * 0.07;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(pulse, pulse);
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 40);
    glow.addColorStop(0, 'rgba(255,70,170,.75)');
    glow.addColorStop(1, 'rgba(255,70,170,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-40, -40, 80, 80);
    ctx.fillStyle = '#ff4fa8';
    roundRect(ctx, -19, -13, 38, 28, 4);
    ctx.fill();
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(-4, -13, 8, 28);
    ctx.fillRect(-19, -3, 38, 7);
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.ellipse(-7, -17, 8, 5, -0.5, 0, Math.PI * 2);
    ctx.ellipse(7, -17, 8, 5, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7a0f52';
    roundRect(ctx, x - 44, y + bob - 40, 88, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText('FREE LOAN!', x, y + bob - 32);
    return;
  }
  if (item.kind === 'bill') {
    ctx.fillStyle = '#5a6172';
    ctx.fillRect(x - 2, y - 2, 4, 26);
    ctx.fillStyle = '#d3362a';
    roundRect(ctx, x - 44, y - 30, 88, 36, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(item.medical ? '✚ HOSPITAL' : '🔧 REPAIR', x, y - 21);
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(money(item.amount), x, y - 7);
    return;
  }
  if (item.kind === 'shield') {
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#00baf2';
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(16, -18, 18, -14);
    ctx.quadraticCurveTo(18, 8, 0, 20);
    ctx.quadraticCurveTo(-18, 8, -18, -14);
    ctx.quadraticCurveTo(-16, -18, 0, -20);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-1, 6);
    ctx.lineTo(8, -7);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#002970';
    roundRect(ctx, x - 40, y + bob - 40, 80, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`COVER ${money(item.amount)}`, x, y + bob - 32);
    return;
  }
  if (item.kind === 'prepay') {
    const glow = ctx.createLinearGradient(x, y - 30, x, y + 26);
    glow.addColorStop(0, '#ffe27a');
    glow.addColorStop(1, '#e7a812');
    ctx.strokeStyle = glow;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(x, y + 22, 34, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#7a5600';
    roundRect(ctx, x - 46, y - 34, 92, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(`PAY EXTRA ${money(item.amount)}`, x, y - 26);
  }
}

export function drawGate(ctx, g, x, gate, money, words) {
  const top = g.roadTop - 54;
  const bottom = g.roadTop + g.roadHeight;
  const finish = gate.finish;
  ctx.fillStyle = finish ? '#0a8a5c' : '#002970';
  ctx.fillRect(x - 6, top, 12, bottom - top);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(x + 6, g.roadTop, 3, g.roadHeight);
  const width = 150, height = 46;
  ctx.fillStyle = finish ? '#0a8a5c' : '#002970';
  roundRect(ctx, x - width / 2, top - height + 4, width, height, 9);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (finish) {
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillText('🏁 LOAN FREE', x, top - height / 2 + 4);
    return;
  }
  if (gate.fee) {
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`FEE ${money(gate.fee)}`, x, top - height / 2 + 4);
    return;
  }
  ctx.font = '800 12px system-ui, sans-serif';
  ctx.fillText(`${words.gate} ${gate.index + 1} / ${gate.total}`, x, top - height + 16);
  const share = gate.share ?? 0;
  const barX = x - width / 2 + 10, barY = top - height + 26, barW = width - 20;
  ctx.fillStyle = '#35c47d';
  roundRect(ctx, barX, barY, barW, 12, 4);
  ctx.fill();
  ctx.fillStyle = '#e8483c';
  roundRect(ctx, barX, barY, Math.max(4, barW * share), 12, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 9px system-ui, sans-serif';
  if (share > 0.14) ctx.fillText(`${Math.round(share * 100)}%`, barX + (barW * share) / 2, barY + 6.5);
}

export function drawMountain(ctx, g, share, balanceText, label) {
  const width = Math.min(170, g.width * 0.28);
  const x = g.width - width - 14;
  const base = 104;
  const height = 8 + 70 * share;
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  roundRect(ctx, x - 8, 8, width + 16, 118, 12);
  ctx.fill();
  ctx.fillStyle = '#6d7a92';
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x + width * 0.3, base - height * 0.68);
  ctx.lineTo(x + width * 0.42, base - height * 0.5);
  ctx.lineTo(x + width * 0.58, base - height);
  ctx.lineTo(x + width, base);
  ctx.closePath();
  ctx.fill();
  if (share > 0.05) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x + width * 0.58, base - height);
    ctx.lineTo(x + width * 0.49, base - height * 0.76);
    ctx.lineTo(x + width * 0.56, base - height * 0.82);
    ctx.lineTo(x + width * 0.62, base - height * 0.72);
    ctx.lineTo(x + width * 0.69, base - height * 0.76);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#d3362a';
  ctx.fillRect(x + width * 0.58 - 1, base - height - 14, 2, 14);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.58 + 1, base - height - 14);
  ctx.lineTo(x + width * 0.58 + 13, base - height - 10);
  ctx.lineTo(x + width * 0.58 + 1, base - height - 6);
  ctx.fill();
  ctx.fillStyle = '#15264a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(label, x + width / 2, 18);
  ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillText(balanceText, x + width / 2, 116);
}

export function drawSack(ctx, share, amountText, label) {
  const x = 14, y = 8;
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  roundRect(ctx, x, y, 108, 118, 12);
  ctx.fill();
  const radius = 11 + Math.min(1, share) * 26;
  const cx = x + 54, cy = 104 - radius;
  ctx.fillStyle = '#b52a20';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8483c';
  ctx.beginPath();
  ctx.arc(cx - radius * 0.2, cy - radius * 0.15, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7d1d15';
  ctx.fillRect(cx - radius * 0.3, cy - radius - 5, radius * 0.6, 6);
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(radius * 0.8)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₹', cx, cy + 1);
  ctx.fillStyle = '#15264a';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(label, x + 54, 18);
  ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillText(amountText, x + 54, 116);
}

export function drawSnowball(ctx, x, y, bounces, time) {
  const radius = 12 + bounces * 7;
  ctx.save();
  ctx.translate(x, y + 10);
  ctx.rotate(time * -4);
  ctx.fillStyle = '#2a0f12';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a1a16';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(Math.cos(i * 1.3) * radius * 0.6, Math.sin(i * 1.3) * radius * 0.6, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawFloats(ctx, floats) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const item of floats) {
    const alpha = Math.min(1, item.life * 1.6);
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${item.size || 16}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,20,60,.65)';
    ctx.strokeText(item.text, item.x, item.y);
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x, item.y);
  }
  ctx.globalAlpha = 1;
}

export function drawParticles(ctx, parts) {
  for (const p of parts) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    if (p.square) ctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
    else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
