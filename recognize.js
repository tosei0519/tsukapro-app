// つかプロ ブロック読み取り
// 白いブロックをつないだ写真から、上から順に「まえ・うしろ・みぎ・ひだり」を読む。AI の学習はいらない。
// ブロックの本当の形（make_blocks.py の OUTLINE と同じ）を写真に重ねて、いちばん合う形を選ぶ。
//
// 形の単位：ブロック1個の高さ（本体）が 130、中心が (0, 0)。本体は y = -65〜65。
//   まえ   … 上が細い矢印（上の辺 ±80、肩 ±200、軸 ±135）
//   うしろ … まえを上下さかさま
//   みぎ   … 左が丸い長方形（-200〜200）＋右に三角の先（先は x = 262、高さ ±107）
//   ひだり … みぎを左右反対
//   上にくぼみ（半径 30）、下に丸い出っぱり（下の端は y = 113）。つなぐと、上のブロックの出っぱりが下のくぼみにはまる。

export const KINDS = ['F', 'B', 'R', 'L'];
const PITCH = 130, KNOB_R = 30, KNOB_OFF = 18, KNOB_BOTTOM = 48, TIP_TOP = 42;

function arc(cx, cy, r, a0, a1, n = 16) {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return p;
}
const H_KNOB = Math.sqrt(KNOB_R * KNOB_R - KNOB_OFF * KNOB_OFF);
const OUT = {
  F: [[-80, -65], 'N', [80, -65], [200, -15], [135, -15], [135, 65], 'K', [-135, 65], [-135, -15], [-200, -15]],
  B: [[-135, -65], 'N', [135, -65], [135, 15], [200, 15], [80, 65], 'K', [-80, 65], [-200, 15], [-135, 15]],
  R: [[-135, -65], 'N', [200, -65], [200, -107], [262, 0], [200, 107], [200, 65], 'K', [-135, 65], 'RND'],
};
// socket: true でくぼみを彫る（いちばん上のブロックだけ）。つないだ所は上のブロックの出っぱりで埋まっている
export function outline(kind, socket = true) {
  if (kind === 'L') return outline('R', socket).map(([x, y]) => [-x, y]).reverse();
  const pts = [];
  for (const p of OUT[kind]) {
    if (p === 'N') {
      if (socket) pts.push([-H_KNOB, -65], ...arc(0, -65 + KNOB_OFF, KNOB_R, Math.atan2(-KNOB_OFF, -H_KNOB), Math.atan2(-KNOB_OFF, H_KNOB) - 2 * Math.PI), [H_KNOB, -65]);
    } else if (p === 'K') {
      pts.push([H_KNOB, 65], ...arc(0, 65 + KNOB_OFF, KNOB_R, Math.atan2(-KNOB_OFF, H_KNOB), Math.atan2(-KNOB_OFF, -H_KNOB) + 2 * Math.PI), [-H_KNOB, 65]);
    } else if (p === 'RND') {
      pts.push(...arc(-135, 0, 65, Math.PI / 2, Math.PI * 1.5));
    } else pts.push(p);
  }
  return pts;
}

function mk(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h});
  return [c, c.getContext('2d', {willReadFrequently: true})];
}

// ---------- 1. 写真 → 白いところ（ブロック）の白黒の図 ----------
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

// 一番大きいかたまりだけ残し、中の小さな穴を埋める
function largestBlob(m, w, h) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h);
  let best = 0, bestId = 0, id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    id++; let n = 0, sp = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const p = stack[--sp]; n++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
    }
    if (n > best) { best = n; bestId = id; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] === bestId ? 1 : 0;
  // 穴埋め：外側から背景をたどり、たどれなかった背景はブロックの中の穴
  const bg = new Uint8Array(w * h); let sp = 0;
  const push = p => { if (!out[p] && !bg[p]) { bg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp], x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  for (let i = 0; i < w * h; i++) if (!bg[i]) out[i] = 1;
  return {mask: out, area: best};
}

// 小さいノイズを消す（3x3 で多数決）
function smooth(m, w, h) {
  const o = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const s = m[i - w - 1] + m[i - w] + m[i - w + 1] + m[i - 1] + m[i] + m[i + 1] + m[i + w - 1] + m[i + w] + m[i + w + 1];
    o[i] = s >= 5 ? 1 : 0;
  }
  return o;
}

export function toMask(source, opt = {}) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  const W = opt.work || 640, s = W / Math.max(sw, sh);
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const [c, g] = mk(w, h);
  g.drawImage(source, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    gray[i] = v; hist[v]++;
  }
  const th = opt.threshold ?? otsu(hist, w * h);
  let m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = (opt.invert ? gray[i] < th : gray[i] > th) ? 1 : 0;
  m = smooth(m, w, h);
  const {mask, area} = largestBlob(m, w, h);
  return {mask, w, h, threshold: th, area};
}

// ---------- 2. かたむきを直す ----------
function moments(m, w, h) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { n++; sx += x; sy += y; }
  const cx = sx / n, cy = sy / n;
  let xx = 0, yy = 0, xy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { const a = x - cx, b = y - cy; xx += a * a; yy += b * b; xy += a * b; }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);         // 長い向きの角度（x 軸から）
  const l1 = (xx + yy) / 2 + Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy), l2 = (xx + yy) / 2 - Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  return {n, cx, cy, ang, elong: Math.sqrt(l1 / Math.max(l2, 1))};
}

function rotateMask(m, w, h, rot, cx, cy) {
  // 回したあとの図（大きさは対角線ぶん）。rot だけ回す（ラジアン）
  const D = Math.ceil(Math.hypot(w, h)), o = new Uint8Array(D * D), c = Math.cos(rot), s = Math.sin(rot);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const dx = x - D / 2, dy = y - D / 2;
    const sx = Math.round(cx + dx * c - dy * s), sy = Math.round(cy + dx * s + dy * c);
    if (sx >= 0 && sy >= 0 && sx < w && sy < h && m[sy * w + sx]) o[y * D + x] = 1;
  }
  return {m: o, w: D, h: D, rot, cx, cy};
}

function bbox(m, w, h) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return {x0, x1: x1 + 1, y0, y1: y1 + 1};
}

// ---------- 3. 形を重ねて読む ----------
// u: 1単位が何ピクセルか、cx: 軸の x、yT: 1個目の本体の上の辺
function bandScores(M, W, u, cx, yT, i, first) {
  const half = 270 * u, x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W.w, Math.ceil(cx + half));
  const yb = yT + i * PITCH * u, y0 = Math.max(0, Math.floor(yb)), y1 = Math.min(W.h, Math.ceil(yb + PITCH * u));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 4 || bh < 4) return null;
  const res = {};
  const [c, g] = mk(bw, bh);
  for (const k of KINDS) {
    g.clearRect(0, 0, bw, bh);
    g.setTransform(u, 0, 0, u, cx - x0, yb + 65 * u - y0);
    g.beginPath();
    outline(k, first).forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath(); g.fillStyle = '#fff'; g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const t = g.getImageData(0, 0, bw, bh).data;
    let agree = 0, cnt = 0, inter = 0, uni = 0;
    for (let y = 0; y < bh; y++) {
      const uy = (y + y0 - yb) / u;                       // 帯の中の高さ（0〜130）
      const nearEdge = uy < TIP_TOP + 4 || uy > PITCH - TIP_TOP - 4;
      for (let x = 0; x < bw; x++) {
        const ux = Math.abs((x + x0 - cx) / u);
        if (nearEdge && ux > 196) continue;               // となりのブロックの先がはみ出してくる所は見ない
        const a = M[(y + y0) * W.w + x + x0], b = t[(y * bw + x) * 4 + 3] > 127 ? 1 : 0;
        cnt++; if (a === b) agree++; if (a && b) inter++; if (a || b) uni++;
      }
    }
    res[k] = cnt ? 0.5 * agree / cnt + 0.5 * (uni ? inter / uni : 0) : 0;
  }
  return res;
}

function tryLayout(M, W, b, N, topTip, cx) {
  const H = b.y1 - b.y0, u = H / (PITCH * N + KNOB_BOTTOM + (topTip ? TIP_TOP : 0));
  const yT = b.y0 + (topTip ? TIP_TOP : 0) * u;
  const kinds = [], scores = [];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const s = bandScores(M, W, u, cx, yT, i, i === 0);
    if (!s) return null;
    let bk = 'F'; for (const k of KINDS) if (s[k] > s[bk]) bk = k;
    // 1個目に先がはみ出す形（みぎ・ひだり）が来るかどうかは topTip と合っていなければならない
    if (i === 0 && topTip !== (bk === 'R' || bk === 'L')) total -= 0.15;
    kinds.push(bk); scores.push(s); total += s[bk];
  }
  return {N, u, cx, yT, topTip, kinds, scores, score: total / N};
}

export function readBlocks(source, opt = {}) {
  const t0 = performance.now();
  const base = toMask(source, opt);
  const {w, h} = base;
  if (base.area < w * h * 0.004) return {ok: false, reason: 'none', base};
  const mo = moments(base.mask, w, h);
  // 角度：まず半分の大きさの図で -24°〜24° を 3° きざみで試し、形がいちばん合った角度の近くを元の大きさで細かく試す
  const deg = Math.PI / 180;
  const hw = w >> 1, hh = h >> 1, half = {w: hw, h: hh, mask: new Uint8Array(hw * hh)};
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * w + 2 * x;
    half.mask[y * hw + x] = base.mask[i] + base.mask[i + 1] + base.mask[i + w] + base.mask[i + w + 1] >= 2 ? 1 : 0;
  }
  const moH = moments(half.mask, hw, hh);
  let coarse = null;
  for (let d = -24; d <= 24; d += 3) {
    const r = readAt(half, moH, d * deg, true);
    if (opt.debug && r) console.log('coarse', d, r.blocks.map(b => b.kind).join(''), r.score.toFixed(3));
    if (r && (!coarse || r.score > coarse.score)) coarse = r;
  }
  if (!coarse) return {ok: false, reason: 'shape', base};
  let out = null;
  for (const dd of [-1, 0, 1]) {
    const rot = coarse.rot + dd * deg;
    const r = readAt(base, mo, rot);
    if (opt.debug && r) console.log('fine', (rot / deg).toFixed(2), r.blocks.map(b => b.kind).join(''), r.score.toFixed(3));
    if (r && (!out || r.score > out.score)) out = r;
  }
  if (!out) return {ok: false, reason: 'shape', base};
  out.ms = Math.round(performance.now() - t0);
  return out;
}

function readAt(base, mo, rot, quick = false) {
  const {w, h} = base;
  const R = rotateMask(base.mask, w, h, rot, mo.cx, mo.cy);
  const M = R.m, Wd = {w: R.w, h: R.h};
  const b = bbox(M, R.w, R.h);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  // ブロックの数のおよそ：幅 400 単位、高さ 130N+48
  const uGuess = bw / 430;
  const nGuess = Math.max(1, Math.round((bh / uGuess - KNOB_BOTTOM) / PITCH));
  // 軸の位置：いちばん下の丸い出っぱりは、必ず軸の真下にある（下の端の数行の真ん中）
  let sx = 0, sn = 0;
  for (let y = b.y1 - 1; y >= b.y0 && y >= b.y1 - 3; y--) for (let x = b.x0; x < b.x1; x++) if (M[y * R.w + x]) { sx += x; sn++; }
  const cxKnob = sn ? sx / sn + 0.5 : (b.x0 + b.x1) / 2;
  let best = null;
  const nr = quick ? 1 : 2;
  for (let N = Math.max(1, nGuess - nr); N <= Math.min(20, nGuess + nr); N++) {
    for (const topTip of [false, true]) {
      for (const d of quick ? [0] : [-1.5, -0.75, 0, 0.75, 1.5]) {
        const r = tryLayout(M, Wd, b, N, topTip, cxKnob + d);
        if (r && (!best || r.score > best.score)) best = r;
      }
    }
  }
  if (!best) return null;
  // 帯ごとの確かさ：1位と2位の差
  const conf = best.scores.map((s, i) => {
    const v = KINDS.map(k => s[k]).sort((a, b2) => b2 - a);
    return {best: v[0], margin: v[0] - v[1]};
  });
  // 写真の上での位置（元の向きに戻す）：各ブロックの中心
  const c = Math.cos(rot), s = Math.sin(rot);
  const toSrc = (x, y) => {
    const dx = x - R.w / 2, dy = y - R.h / 2;
    return [(mo.cx + dx * c - dy * s) / base.w, (mo.cy + dx * s + dy * c) / base.h];
  };
  const blocks = best.kinds.map((k, i) => {
    const yc = best.yT + (i + 0.5) * PITCH * best.u;
    const [px, py] = toSrc(best.cx, yc);
    return {kind: k, x: px, y: py, conf: conf[i].best, margin: conf[i].margin};
  });
  return {
    ok: best.score > 0.72, score: best.score, blocks, rot, unit: best.u / base.w, base,
    cxInfo: [cxKnob.toFixed(1), best.cx.toFixed(1), b.x0, b.x1, best.N],
  };
}

// 確認用：白黒の図を canvas に描く
export function drawMask(canvas, base) {
  canvas.width = base.w; canvas.height = base.h;
  const g = canvas.getContext('2d'), im = g.createImageData(base.w, base.h);
  for (let i = 0; i < base.w * base.h; i++) {
    const v = base.mask[i] ? 255 : 30;
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}
