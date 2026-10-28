import { acabamento, brilho, css, elipse, hash, linha, luz, mistura, poli, ret, type Ctx, type RGB } from './pixelArte.js';

/**
 * Sala de treino e decorações da casa do Cyberidle - arte PRÓPRIA gerada por código, no lugar
 * dos sprites do cliente original: piso de dojo com grade neon, paredes com faixa de luz,
 * robôs de treino (um visual por boneco), alvo holográfico, saco de pancada, poste neon,
 * letreiro holográfico, tapete de LED, fonte holográfica e estátua cromada.
 * Só canvas (sem Pixi), para servir também de ícone na interface.
 * Lab Hub, Claude (Opus 5.5), 28/10/2026.
 */

const T = 32;
const G = 64;
const METAL: RGB = [140, 150, 178];
const ESCURO: RGB = [40, 46, 70];
const CIANO: RGB = [0, 229, 255];
const MAGENTA: RGB = [255, 60, 210];

const cache = new Map<string, HTMLCanvasElement>();

function canvas(chave: string, tam: number, corpo: (g: Ctx) => void, luzes?: (g: Ctx) => void, comAcabamento = true): HTMLCanvasElement {
  const pronto = cache.get(chave);
  if (pronto) return pronto;
  const c = document.createElement('canvas');
  c.width = tam; c.height = tam;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  corpo(g);
  if (comAcabamento) acabamento(g, tam);
  luzes?.(g);
  cache.set(chave, c);
  return c;
}

const sombra = (g: Ctx, cx: number, y: number, larg: number) => {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.ellipse(cx, y, larg, 3, 0, 0, Math.PI * 2); g.fill();
};

// ---------------------------------------------------------------- bonecos de treino

type Boneco = 'robo' | 'alvo' | 'saco';
interface VisualBoneco { tipo: Boneco; cor: RGB; enfeite?: 'chifres' | 'capuz' | 'faixa' | 'farao' | 'aletas' }

/** Item do boneco (trainingRooms.ts) -> visual neon. */
const BONECOS: Record<number, VisualBoneco> = {
  15710: { tipo: 'alvo', cor: MAGENTA },
  15711: { tipo: 'alvo', cor: [255, 210, 60] },
  50143: { tipo: 'saco', cor: [255, 140, 60] },
  28558: { tipo: 'robo', cor: CIANO },
  28559: { tipo: 'robo', cor: [176, 90, 255], enfeite: 'capuz' },
  28561: { tipo: 'robo', cor: [255, 50, 70], enfeite: 'chifres' },
  28563: { tipo: 'robo', cor: [255, 154, 60], enfeite: 'faixa' },
  50435: { tipo: 'robo', cor: [57, 255, 136] },
  12047: { tipo: 'robo', cor: [255, 205, 60], enfeite: 'farao' },
  12048: { tipo: 'robo', cor: [60, 140, 255], enfeite: 'aletas' },
};

export function ehBoneco(itemId: number): boolean {
  return itemId in BONECOS;
}

/** Boneco de treino 64x64, apoiado na base do quadro. */
export function bonecoCanvas(itemId: number): HTMLCanvasElement | null {
  const v = BONECOS[itemId];
  if (!v || typeof document === 'undefined') return null;
  const cx = G / 2;
  const casco = mistura(v.cor, 0.42);
  if (v.tipo === 'alvo') {
    return canvas(`boneco:${itemId}`, G, (g) => {
      sombra(g, cx, 60, 14);
      linha(g, METAL, cx - 10, 60, cx - 3, 38, 3);
      linha(g, METAL, cx + 10, 60, cx + 3, 38, 3);
      elipse(g, ESCURO, cx, 26, 17, 17);
      elipse(g, casco, cx, 26, 13, 13);
      elipse(g, ESCURO, cx, 26, 8, 8);
    }, (g) => {
      g.strokeStyle = css(v.cor); g.lineWidth = 2;
      g.beginPath(); g.arc(cx, 26, 15, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, 26, 10, 0, Math.PI * 2); g.stroke();
      elipse(g, v.cor, cx, 26, 3.5, 3.5);
      brilho(g, v.cor, cx, 26, 22, 0.3);
    });
  }
  if (v.tipo === 'saco') {
    return canvas(`boneco:${itemId}`, G, (g) => {
      sombra(g, cx, 61, 12);
      linha(g, METAL, cx, 0, cx, 10, 2);
      ret(g, casco, cx - 10, 9, 20, 46, 9);
      ret(g, ESCURO, cx - 10, 52, 20, 5, 2);
    }, (g) => {
      for (const y of [18, 30, 42]) luz(g, v.cor, cx - 9, y, 18, 2);
      brilho(g, v.cor, cx, 30, 18, 0.25);
    });
  }
  return canvas(`boneco:${itemId}`, G, (g) => {
    sombra(g, cx, 61, 14);
    ret(g, ESCURO, cx - 12, 56, 24, 5, 2);
    ret(g, METAL, cx - 3, 40, 6, 17, 1);
    ret(g, METAL, cx - 19, 22, 7, 15, 3);
    ret(g, METAL, cx + 12, 22, 7, 15, 3);
    ret(g, casco, cx - 12, 19, 24, 23, 5);
    ret(g, METAL, cx - 8, 5, 16, 14, 4);
    if (v.enfeite === 'chifres') {
      poli(g, mistura(v.cor, 0.7), [[cx - 8, 8], [cx - 13, -1], [cx - 4, 5]]);
      poli(g, mistura(v.cor, 0.7), [[cx + 8, 8], [cx + 13, -1], [cx + 4, 5]]);
    }
    if (v.enfeite === 'capuz') poli(g, casco, [[cx - 11, 20], [cx - 10, 6], [cx, 0], [cx + 10, 6], [cx + 11, 20]]);
    if (v.enfeite === 'farao') poli(g, [200, 160, 50], [[cx - 12, 22], [cx - 10, 4], [cx + 10, 4], [cx + 12, 22], [cx + 6, 14], [cx - 6, 14]]);
    if (v.enfeite === 'aletas') {
      poli(g, casco, [[cx - 8, 10], [cx - 15, 4], [cx - 9, 16]]);
      poli(g, casco, [[cx + 8, 10], [cx + 15, 4], [cx + 9, 16]]);
    }
  }, (g) => {
    luz(g, v.cor, cx - 6, 10, 12, 3);
    if (v.enfeite === 'faixa') luz(g, v.cor, cx - 8, 6, 16, 2);
    g.strokeStyle = css(v.cor); g.lineWidth = 2;
    g.beginPath(); g.arc(cx, 30, 6, 0, Math.PI * 2); g.stroke();
    luz(g, v.cor, cx - 1, 29, 2, 2);
    luz(g, v.cor, cx - 18, 33, 5, 2); luz(g, v.cor, cx + 13, 33, 5, 2);
    brilho(g, v.cor, cx, 30, 14, 0.25);
  });
}

// ---------------------------------------------------------------- enfeites

export type Enfeite = 'poste' | 'letreiro' | 'tapete' | 'fonte' | 'estatua' | 'rack';

/** Enfeite 64x64 (tapete: 32x32, vai no chão), apoiado na base do quadro. */
export function enfeiteCanvas(tipo: Enfeite, variante = 0): HTMLCanvasElement {
  const cx = G / 2;
  const cor = variante % 2 ? MAGENTA : CIANO;
  switch (tipo) {
    case 'poste':
      return canvas(`enf:poste:${variante % 2}`, G, (g) => {
        sombra(g, cx, 61, 8);
        ret(g, ESCURO, cx - 6, 56, 12, 5, 2);
        ret(g, METAL, cx - 2, 18, 4, 40, 1);
        ret(g, METAL, cx - 5, 12, 10, 8, 2);
      }, (g) => {
        ret(g, cor, cx - 3, 4, 6, 10, 2);
        luz(g, [255, 255, 255], cx - 1, 6, 2, 6);
        brilho(g, cor, cx, 9, 20, 0.55);
        luz(g, cor, cx - 1, 30, 2, 18);
      });
    case 'letreiro':
      return canvas(`enf:letreiro:${variante % 2}`, G, (g) => {
        ret(g, METAL, cx - 22, 14, 44, 3, 1);
        linha(g, METAL, cx - 18, 14, cx - 18, 8, 1);
        linha(g, METAL, cx + 18, 14, cx + 18, 8, 1);
        ret(g, [16, 18, 34], cx - 20, 17, 40, 40, 2);
      }, (g) => {
        g.strokeStyle = css(cor); g.lineWidth = 2;
        g.strokeRect(cx - 18, 19, 36, 36);
        // Logo do Cyberidle: dois triângulos (◢◤).
        poli(g, cor, [[cx - 10, 46], [cx - 1, 46], [cx - 1, 28]]);
        poli(g, mistura(cor === CIANO ? MAGENTA : CIANO, 1), [[cx + 1, 28], [cx + 10, 28], [cx + 1, 46]]);
        brilho(g, cor, cx, 37, 26, 0.3);
      });
    case 'tapete':
      return canvas(`enf:tapete:${variante % 2}`, T, (g) => {
        g.fillStyle = 'rgba(20, 10, 40, 0.85)'; g.fillRect(0, 2, T, T - 4);
        g.fillStyle = css(cor, 0.9); g.fillRect(0, 3, T, 1); g.fillRect(0, T - 4, T, 1);
        g.fillStyle = css(cor, 0.35);
        for (let x = 3; x < T; x += 8) g.fillRect(x, 13, 4, 6);
      }, undefined, false);
    case 'fonte':
      return canvas('enf:fonte', G, (g) => {
        sombra(g, cx, 60, 24);
        elipse(g, METAL, cx, 52, 24, 9);
        elipse(g, [20, 50, 70], cx, 50, 19, 6);
        ret(g, METAL, cx - 4, 26, 8, 24, 2);
        elipse(g, METAL, cx, 26, 10, 4);
      }, (g) => {
        for (let i = 0; i < 9; i += 1) {
          const a = (i / 9) * Math.PI * 2;
          luz(g, CIANO, Math.round(cx + Math.cos(a) * 14), Math.round(48 + Math.sin(a) * 3), 2, 2);
        }
        g.fillStyle = css(CIANO, 0.45); g.fillRect(cx - 2, 4, 4, 22);
        linha(g, css(CIANO, 0.7), cx, 8, cx - 12, 22, 1);
        linha(g, css(CIANO, 0.7), cx, 8, cx + 12, 22, 1);
        brilho(g, CIANO, cx, 30, 30, 0.35);
      });
    case 'estatua':
      return canvas('enf:estatua', G, (g) => {
        sombra(g, cx, 61, 16);
        ret(g, ESCURO, cx - 14, 48, 28, 13, 2);
        ret(g, [190, 200, 222], cx - 9, 18, 18, 26, 5);
        elipse(g, [210, 218, 236], cx, 11, 7, 8);
        ret(g, [190, 200, 222], cx - 16, 20, 7, 18, 3);
        ret(g, [190, 200, 222], cx + 9, 20, 7, 18, 3);
        ret(g, [170, 180, 205], cx - 8, 40, 7, 9, 2);
        ret(g, [170, 180, 205], cx + 1, 40, 7, 9, 2);
      }, (g) => {
        luz(g, MAGENTA, cx - 5, 10, 10, 2);
        luz(g, CIANO, cx - 12, 53, 24, 1);
        brilho(g, MAGENTA, cx, 22, 20, 0.25);
      });
    case 'rack':
    default:
      return canvas(`enf:rack:${variante % 3}`, G, (g) => {
        sombra(g, cx, 61, 14);
        ret(g, ESCURO, cx - 12, 14, 24, 47, 2);
        for (let y = 18; y < 58; y += 8) ret(g, [28, 32, 52], cx - 9, y, 18, 6, 1);
      }, (g) => {
        const r = (n: number) => hash(`rack${variante}:${n}`) % 3;
        for (let y = 18, i = 0; y < 58; y += 8, i += 1) {
          luz(g, [CIANO, MAGENTA, [57, 255, 136] as RGB][r(i)]!, cx - 7, y + 2, 2, 2);
          luz(g, CIANO, cx + 2, y + 2, 5, 1);
        }
      });
  }
}

/** Item dos props da sala de treino (trainingRooms.ts) -> enfeite neon. */
export const PROP_TREINO: Record<number, Enfeite> = {
  2920: 'poste', 2921: 'poste', 2366: 'rack', 2367: 'rack', 26119: 'tapete', 50139: 'rack',
};

/** Decoração da casa (progression.ts DECORATIONS) -> enfeite neon e onde fica na tela. */
export const DECORACAO_CASA: Record<string, Array<{ tipo: Enfeite; x: number; y: number }>> = {
  torch: [{ tipo: 'poste', x: 1, y: 2 }, { tipo: 'poste', x: 11, y: 2 }, { tipo: 'poste', x: 1, y: 8 }, { tipo: 'poste', x: 11, y: 8 }],
  banner: [{ tipo: 'letreiro', x: 5, y: 1 }, { tipo: 'letreiro', x: 7, y: 1 }],
  carpet: [{ tipo: 'tapete', x: 5, y: 8 }, { tipo: 'tapete', x: 6, y: 8 }, { tipo: 'tapete', x: 7, y: 8 }],
  fountain: [{ tipo: 'fonte', x: 2, y: 8 }],
  statue: [{ tipo: 'estatua', x: 10, y: 8 }],
};

// ---------------------------------------------------------------- piso e paredes do dojo

/** Piso do dojo: placas escuras em xadrez com junta neon. */
export function pisoCanvas(x: number, y: number): HTMLCanvasElement {
  const par = (x + y) % 2 === 0;
  const v = hash(`piso${x}:${y}`) % 4;
  return canvas(`piso:${par ? 1 : 0}:${v}`, T, (g) => {
    g.fillStyle = par ? '#141a33' : '#10142a'; g.fillRect(0, 0, T, T);
    g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(1, 1, T - 2, 1);
    g.fillStyle = 'rgba(0,229,255,0.16)'; g.fillRect(0, 0, T, 1); g.fillRect(0, 0, 1, T);
    if (v === 0) { g.fillStyle = 'rgba(255,60,210,0.12)'; g.fillRect(8, 15, 16, 2); }
    if (v === 1) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(20, 6, 6, 3); }
  }, undefined, false);
}

/** Parede do dojo: painel escuro com faixa de luz voltada para dentro da sala. */
export function paredeCanvas(lado: 'n' | 's' | 'l' | 'o' | 'canto', x: number): HTMLCanvasElement {
  const tela = lado === 'n' && x % 3 === 1;
  return canvas(`parede:${lado}:${tela ? 1 : 0}`, T, (g) => {
    g.fillStyle = '#0a0d1c'; g.fillRect(0, 0, T, T);
    g.fillStyle = '#161c36';
    g.fillRect(2, 2, T - 4, T - 4);
    g.fillStyle = 'rgba(0,229,255,0.85)';
    if (lado === 'n') g.fillRect(0, T - 3, T, 2);
    if (lado === 's') g.fillRect(0, 1, T, 2);
    if (lado === 'l') g.fillRect(T - 3, 0, 2, T);
    if (lado === 'o') g.fillRect(1, 0, 2, T);
    if (tela) {
      g.fillStyle = '#05121c'; g.fillRect(6, 6, 20, 14);
      g.fillStyle = 'rgba(255,60,210,0.9)';
      g.fillRect(8, 9, 10, 2); g.fillRect(8, 13, 14, 2);
    }
  }, undefined, false);
}
