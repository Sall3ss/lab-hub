/**
 * Primitivas de pixel art compartilhadas pelos desenhos próprios do Cyberidle (personagens,
 * monstros e ícones de itens): cores, formas e o acabamento automático (pixels cheios, relevo
 * e contorno). Sem dependência do Pixi. Lab Hub, Claude (Opus 5.5), 28/10/2026.
 */

export type Ctx = CanvasRenderingContext2D;
export type RGB = [number, number, number];

export function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hslRgb(h: number, s: number, l: number): RGB {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export const css = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
export const mistura = (c: RGB, f: number): RGB => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];

/** Pixel art: alfa cheio ou vazio, relevo (luz em cima, sombra embaixo/direita) e contorno. */
export function acabamento(g: Ctx, tam: number): void {
  const img = g.getImageData(0, 0, tam, tam);
  const d = img.data;
  const cheio = new Uint8Array(tam * tam);
  for (let i = 0; i < tam * tam; i += 1) {
    const a = d[i * 4 + 3]!;
    if (a >= 110) { cheio[i] = 1; d[i * 4 + 3] = 255; } else d[i * 4 + 3] = 0;
  }
  const em = (x: number, y: number) => x >= 0 && y >= 0 && x < tam && y < tam && cheio[y * tam + x] === 1;
  const mesmaCor = (i: number, j: number) => Math.abs(d[i * 4]! - d[j * 4]!) + Math.abs(d[i * 4 + 1]! - d[j * 4 + 1]!) + Math.abs(d[i * 4 + 2]! - d[j * 4 + 2]!) < 40;
  const saida = new Uint8ClampedArray(d);
  for (let y = 0; y < tam; y += 1) {
    for (let x = 0; x < tam; x += 1) {
      const i = y * tam + x;
      if (cheio[i]) {
        // Relevo por parte: borda de cima de cada região de cor clareia, de baixo/direita escurece.
        const acima = y > 0 ? i - tam : -1;
        const abaixo = y < tam - 1 ? i + tam : -1;
        const dir = x < tam - 1 ? i + 1 : -1;
        let f = 1;
        if (acima < 0 || !cheio[acima] || !mesmaCor(i, acima)) f = 1.28;
        else if (abaixo < 0 || !cheio[abaixo] || !mesmaCor(i, abaixo) || dir < 0 || !cheio[dir] || !mesmaCor(i, dir)) f = 0.72;
        if (f !== 1) for (let k = 0; k < 3; k += 1) saida[i * 4 + k] = Math.min(255, d[i * 4 + k]! * f);
      } else if (em(x - 1, y) || em(x + 1, y) || em(x, y - 1) || em(x, y + 1)) {
        saida[i * 4] = 8; saida[i * 4 + 1] = 9; saida[i * 4 + 2] = 18; saida[i * 4 + 3] = 255;
      }
    }
  }
  img.data.set(saida);
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- primitivas

export function elipse(g: Ctx, c: RGB | string, cx: number, cy: number, rx: number, ry: number) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
}
export function ret(g: Ctx, c: RGB | string, x: number, y: number, w: number, h: number, r = 0) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
export function poli(g: Ctx, c: RGB | string, pts: Array<[number, number]>) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.closePath(); g.fill();
}
export function linha(g: Ctx, c: RGB | string, x1: number, y1: number, x2: number, y2: number, w = 2) {
  g.strokeStyle = typeof c === 'string' ? c : css(c); g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
export function brilho(g: Ctx, c: RGB, x: number, y: number, raio: number, forca = 0.7) {
  const grad = g.createRadialGradient(x, y, 0, x, y, raio);
  grad.addColorStop(0, css(c, forca));
  grad.addColorStop(1, css(c, 0));
  g.fillStyle = grad;
  g.fillRect(x - raio, y - raio, raio * 2, raio * 2);
}
export function luz(g: Ctx, c: RGB, x: number, y: number, w: number, h: number) {
  g.fillStyle = css(c); g.fillRect(x, y, w, h);
}
export function sombraChao(g: Ctx, cx: number, base: number, larg: number) {
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.beginPath(); g.ellipse(cx, base, larg, 3, 0, 0, Math.PI * 2); g.fill();
}
