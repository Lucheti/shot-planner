import type { AspectRatio } from '../domain/shot.js';

const DIMENSIONS: Readonly<Record<AspectRatio, readonly [number, number]>> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [960, 960],
  '4:3': [1200, 900],
  '3:4': [900, 1200],
  '21:9': [1400, 600],
};

const HUE_KEYWORDS: readonly (readonly [RegExp, number])[] = [
  [/warm|sun|golden|morning|dawn|amber|clay|terracotta|fire/i, 24],
  [/night|moon|blue|rain|cold|ice|ocean|sea|dusk/i, 222],
  [/forest|green|plant|garden|leaf|moss/i, 140],
  [/neon|pink|magenta|synth/i, 320],
];

/** FNV-1a: a small, stable string hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h) % 360} ${Math.round(s)}% ${Math.round(l)}%)`;
}

function hills(rand: () => number, w: number, h: number, baseY: number, fill: string): string {
  const points = 6;
  const step = w / (points - 1);
  const ys = Array.from({ length: points }, () => baseY + (rand() - 0.5) * h * 0.22);
  let d = `M0 ${h} L0 ${ys[0]}`;
  for (let i = 1; i < points; i += 1) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    d += ` C${x0 + step / 2} ${ys[i - 1]}, ${x0 + step / 2} ${ys[i]}, ${x1} ${ys[i]}`;
  }
  return `<path d="${d} L${w} ${h} Z" fill="${fill}"/>`;
}

function artwork(prompt: string, aspectRatio: AspectRatio): { w: number; h: number; body: string } {
  const [w, h] = DIMENSIONS[aspectRatio];
  const seed = hash(`${prompt.trim().toLowerCase()}|${aspectRatio}`);
  const rand = seeded(seed);
  const keyword = HUE_KEYWORDS.find(([pattern]) => pattern.test(prompt));
  const hue = (keyword ? keyword[1] : rand() * 360) + (rand() - 0.5) * 24;
  const sunX = w * (0.2 + rand() * 0.6);
  const sunY = h * (0.18 + rand() * 0.3);
  const sunR = Math.min(w, h) * (0.07 + rand() * 0.09);
  const layers = [0.58, 0.7, 0.82].map((y, i) =>
    hills(rand, w, h, h * y, hsl(hue + i * 10, 28 - i * 4, 34 - i * 9)),
  );
  const body = [
    `<defs>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue + 18, 55, 30)}"/><stop offset="0.65" stop-color="${hsl(hue, 70, 62)}"/><stop offset="1" stop-color="${hsl(hue - 14, 80, 78)}"/></linearGradient>`,
    `<radialGradient id="glow"><stop offset="0" stop-color="${hsl(hue - 10, 95, 90)}" stop-opacity="0.95"/><stop offset="1" stop-color="${hsl(hue - 10, 95, 80)}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>`,
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 997}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/></filter>`,
    `</defs>`,
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="${sunR * 3.2}" fill="url(#glow)"/>`,
    `<circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${hsl(hue - 10, 95, 92)}"/>`,
    ...layers,
    `<rect width="${w}" height="${h}" filter="url(#grain)"/>`,
    `<rect width="${w}" height="${h}" fill="url(#vignette)"/>`,
  ].join('');
  return { w, h, body };
}

/** A deterministic still "photograph": colours and shapes are derived from the prompt. */
export function renderKeyframeSvg(prompt: string, aspectRatio: AspectRatio): string {
  const { w, h, body } = artwork(prompt, aspectRatio);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

/** A deterministic animated "clip": the keyframe with a slow push-in and a drifting light sweep. */
export function renderClipSvg(prompt: string, aspectRatio: AspectRatio, seconds: number): string {
  const { w, h, body } = artwork(prompt, aspectRatio);
  const s = Math.max(1, seconds);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<style>`,
    `.push{transform-origin:50% 50%;transform-box:fill-box;animation:push ${s}s ease-in-out infinite alternate}`,
    `.sweep{animation:sweep ${s}s linear infinite}`,
    `@keyframes push{from{transform:scale(1)}to{transform:scale(1.14)}}`,
    `@keyframes sweep{from{transform:translateX(-${w}px)}to{transform:translateX(${w}px)}}`,
    `</style>`,
    `<defs><linearGradient id="sweepGradient"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`,
    `<g class="push">${body}</g>`,
    `<rect class="sweep" width="${w}" height="${h}" fill="url(#sweepGradient)"/>`,
    `</svg>`,
  ].join('');
}
