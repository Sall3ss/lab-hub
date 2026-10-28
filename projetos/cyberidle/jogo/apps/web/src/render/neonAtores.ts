import { Texture } from 'pixi.js';

/**
 * Monstros e personagens do Cyberidle - arte PRÓPRIA gerada por código (nada do cliente
 * original), no estilo pixel/neon dos mapas (neonMapa.ts).
 *
 * v2 (pedido do dono: "não só blocos quadrados, dá pra identificar o personagem"): desenho em
 * 48 px com formas arredondadas e o acabamento clássico de pixel art, feito automaticamente:
 *   1. as partes são desenhadas com formas (elipses, polígonos);
 *   2. `pixelar` deixa cada pixel 100% cheio ou vazio (nada borrado);
 *   3. luz por cima e sombra por baixo/direita em cada parte (relevo);
 *   4. contorno escuro de 1 px em volta da figura;
 *   5. por último, os brilhos neon (visor, olhos, armas), que ficam por cima do contorno.
 *
 * Monstro: formato pela classe do bestiário, cor fixa por espécie (hash do id). Personagem:
 * ciborgue com a silhueta e o acessório da classe, nas cores do Outfit. Quadros parado (2,
 * respirando) e andando (4), de frente (sul) e de lado (oeste; leste é o espelho).
 * Lab Hub, Claude (Opus 5.5), 27/10/2026.
 */

const DIR_SUL = 2;
/** Tamanho do canvas; a cena mostra com ESCALA_GERADO (combat.ts). */
const TAM = 48;
const TAM_GRANDE = 64;

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hslRgb(h: number, s: number, l: number): RGB {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const css = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mistura = (c: RGB, f: number): RGB => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];

const cache = new Map<string, Texture[]>();

/**
 * Gera os quadros: `corpo` desenha as formas (recebem acabamento), `luzes` desenha os brilhos
 * por cima depois do acabamento.
 */
function quadros(
  chave: string, tamanho: number, n: number,
  corpo: (g: Ctx, q: number) => void,
  luzes?: (g: Ctx, q: number) => void,
): Texture[] {
  const pronto = cache.get(chave);
  if (pronto && pronto.every((t) => !t.destroyed)) return pronto;
  const lista: Texture[] = [];
  for (let q = 0; q < n; q += 1) {
    const c = document.createElement('canvas');
    c.width = tamanho;
    c.height = tamanho;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    corpo(g, q);
    acabamento(g, tamanho);
    if (luzes) luzes(g, q);
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    lista.push(t);
  }
  cache.set(chave, lista);
  return lista;
}

/** Pixel art: alfa cheio ou vazio, relevo (luz em cima, sombra embaixo/direita) e contorno. */
function acabamento(g: Ctx, tam: number): void {
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

function elipse(g: Ctx, c: RGB | string, cx: number, cy: number, rx: number, ry: number) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
}
function ret(g: Ctx, c: RGB | string, x: number, y: number, w: number, h: number, r = 0) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
function poli(g: Ctx, c: RGB | string, pts: Array<[number, number]>) {
  g.fillStyle = typeof c === 'string' ? c : css(c);
  g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.closePath(); g.fill();
}
function linha(g: Ctx, c: RGB | string, x1: number, y1: number, x2: number, y2: number, w = 2) {
  g.strokeStyle = typeof c === 'string' ? c : css(c); g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
function brilho(g: Ctx, c: RGB, x: number, y: number, raio: number, forca = 0.7) {
  const grad = g.createRadialGradient(x, y, 0, x, y, raio);
  grad.addColorStop(0, css(c, forca));
  grad.addColorStop(1, css(c, 0));
  g.fillStyle = grad;
  g.fillRect(x - raio, y - raio, raio * 2, raio * 2);
}
function luz(g: Ctx, c: RGB, x: number, y: number, w: number, h: number) {
  g.fillStyle = css(c); g.fillRect(x, y, w, h);
}
function sombraChao(g: Ctx, cx: number, base: number, larg: number) {
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.beginPath(); g.ellipse(cx, base, larg, 3, 0, 0, Math.PI * 2); g.fill();
}

// ---------------------------------------------------------------- personagens

export interface JogadorGerado { vocationId: number; corCorpo?: RGB; corPernas?: RGB; corCabeca?: RGB }

type Tipo = 'samurai' | 'gun' | 'net' | 'bio' | 'monk';
const CLASSE: Record<number, { neon: RGB; tipo: Tipo }> = {
  4: { neon: [255, 60, 210], tipo: 'samurai' }, 8: { neon: [255, 60, 210], tipo: 'samurai' },
  3: { neon: [255, 210, 60], tipo: 'gun' }, 7: { neon: [255, 210, 60], tipo: 'gun' },
  1: { neon: [0, 229, 255], tipo: 'net' }, 5: { neon: [0, 229, 255], tipo: 'net' },
  2: { neon: [57, 255, 136], tipo: 'bio' }, 6: { neon: [57, 255, 136], tipo: 'bio' },
  9: { neon: [255, 154, 60], tipo: 'monk' }, 10: { neon: [255, 154, 60], tipo: 'monk' },
};

const PELE: RGB = [214, 162, 124];
const CROMO: RGB = [138, 150, 178];
const BOTA: RGB = [26, 28, 40];

// ---------------------------------------------------------------- arte feita em IA pelo dono
// Uma imagem de frente por classe (site/assets/personagens/<classe>.png). O jogo espelha para
// os lados e anima respirar/andar por código. Enquanto a imagem não carrega (ou se a classe
// ainda não tem imagem), usa o desenho gerado acima. Lab Hub, Claude (Opus 5.5), 28/10/2026.

const ARQUIVO_CLASSE: Record<Tipo, string> = { samurai: 'samurai', gun: 'gunslinger', net: 'netrunner', bio: 'biohacker', monk: 'monk' };
const imagens = new Map<Tipo, HTMLImageElement>();
/** Altura na tela (px de mundo) que a arte da IA ocupa. */
export const ALTURA_PERSONAGEM = 46;

function carregarImagens(): void {
  if (typeof document === 'undefined') return;
  for (const tipo of Object.keys(ARQUIVO_CLASSE) as Tipo[]) {
    const img = new Image();
    img.onload = () => { imagens.set(tipo, img); };
    img.src = `${import.meta.env.BASE_URL}assets/personagens/${ARQUIVO_CLASSE[tipo]}.png`;
  }
}
carregarImagens();

/** A classe já tem a arte da IA carregada? (a cena troca o desenho quando passa a ter) */
export function temArteIa(vocationId: number): boolean {
  return imagens.has((CLASSE[vocationId] ?? CLASSE[4]!).tipo);
}

/** Escala de exibição para o personagem (a arte da IA tem altura própria). */
export function escalaJogador(vocationId: number): number | undefined {
  const img = imagens.get((CLASSE[vocationId] ?? CLASSE[4]!).tipo);
  return img ? ALTURA_PERSONAGEM / img.naturalHeight : undefined;
}

function quadrosDaImagem(img: HTMLImageElement, chave: string, andando: boolean): Texture[] {
  const pronto = cache.get(chave);
  if (pronto && pronto.every((t) => !t.destroyed)) return pronto;
  const tam = Math.max(img.naturalWidth + 4, img.naturalHeight + 6);
  const n = andando ? 4 : 2;
  const lista: Texture[] = [];
  for (let q = 0; q < n; q += 1) {
    const c = document.createElement('canvas');
    c.width = tam; c.height = tam;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const bob = andando ? (q % 2 ? -2 : 0) : (q ? -1 : 0);
    const inclina = andando ? [1, 0, -1, 0][q]! : 0;
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.beginPath(); g.ellipse(tam / 2, tam - 4, img.naturalWidth * 0.32, 3.5, 0, 0, Math.PI * 2); g.fill();
    g.drawImage(img, Math.round((tam - img.naturalWidth) / 2) + inclina, tam - 4 - img.naturalHeight + bob);
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    lista.push(t);
  }
  cache.set(chave, lista);
  return lista;
}

export function quadrosJogador(j: JogadorGerado, direcao: number, andando: boolean): Texture[] {
  const classe = CLASSE[j.vocationId] ?? CLASSE[4]!;
  const img = imagens.get(classe.tipo);
  if (img) return quadrosDaImagem(img, `ia:${classe.tipo}:${andando ? 1 : 0}`, andando);
  const jaqueta = j.corCorpo ?? [70, 56, 140];
  const calca = j.corPernas ?? [34, 38, 66];
  const cabelo = j.corCabeca ?? [26, 28, 44];
  const lado = direcao !== DIR_SUL;
  const t = classe.tipo;
  const chave = `jog2:${j.vocationId}:${jaqueta}:${calca}:${cabelo}:${lado ? 'l' : 'f'}:${andando ? 1 : 0}`;
  const cx = 24;
  const base = 45;
  const pose = (q: number) => ({
    bob: andando ? (q % 2 ? -1 : 0) : (q ? -1 : 0),
    passo: andando ? [2, 0, -2, 0][q % 4]! : 0,
  });

  return quadros(chave, TAM, andando ? 4 : 2, (g, q) => {
    const { bob, passo } = pose(q);
    const top = 8 + bob;
    sombraChao(g, cx, base, 10);
    // --- pernas e botas
    const pernaE = lado ? cx - 3 + passo : cx - 5;
    const pernaD = lado ? cx + 1 - passo : cx + 1;
    ret(g, calca, pernaE, top + 22, 5, 13 + (passo > 0 && !lado ? -1 : 0), 1);
    ret(g, calca, pernaD, top + 22, 5, 13 + (passo < 0 && !lado ? -1 : 0), 1);
    ret(g, BOTA, pernaE - 1, base - 5 - (passo > 0 && !lado ? 1 : 0), 7, 5, 1);
    ret(g, BOTA, pernaD - 1, base - 5 - (passo < 0 && !lado ? 1 : 0), 7, 5, 1);
    // --- tronco (casaco longo para net/bio, quimono para monk)
    if (t === 'net' || t === 'bio') poli(g, jaqueta, [[cx - 9, top + 12], [cx + 9, top + 12], [cx + 11, top + 33], [cx - 11, top + 33]]);
    if (t === 'monk') poli(g, mistura(jaqueta, 1.1), [[cx - 8, top + 12], [cx + 8, top + 12], [cx + 9, top + 28], [cx - 9, top + 28]]);
    ret(g, jaqueta, cx - 8, top + 11, 16, 14, 4);
    if (t === 'samurai') { ret(g, CROMO, cx - 11, top + 10, 6, 5, 2); ret(g, CROMO, cx + 5, top + 10, 6, 5, 2); } // ombreiras
    if (t === 'gun') { poli(g, mistura(jaqueta, 0.8), [[cx - 9, top + 11], [cx - 2, top + 11], [cx - 5, top + 20]]); } // gola
    // cinto
    ret(g, mistura(calca, 0.7), cx - 8, top + 22, 16, 2);
    // --- braços (balançam ao andar)
    const bE = lado ? passo : -passo;
    ret(g, t === 'monk' ? PELE : jaqueta, cx - 12, top + 12 + Math.max(0, bE), 4, 10, 2);
    ret(g, t === 'samurai' || t === 'gun' ? CROMO : jaqueta, cx + 8, top + 12 + Math.max(0, -bE), 4, 10, 2);
    ret(g, PELE, cx - 12, top + 21 + Math.max(0, bE), 4, 3, 1);
    ret(g, t === 'samurai' || t === 'gun' ? CROMO : PELE, cx + 8, top + 21 + Math.max(0, -bE), 4, 3, 1);
    // --- cabeça
    elipse(g, PELE, cx + (lado ? -1 : 0), top + 5, 6, 6);
    if (t === 'net') {
      poli(g, mistura(jaqueta, 0.65), [[cx - 9, top + 9], [cx - 7, top - 3], [cx, top - 5], [cx + 7, top - 3], [cx + 9, top + 9], [cx + 6, top + 4], [cx - 6, top + 4]]); // capuz
    } else if (t === 'samurai') {
      poli(g, cabelo, [[cx - 7, top + 3], [cx - 5, top - 3], [cx + 5, top - 3], [cx + 7, top + 3], [cx + 3, top + 1], [cx - 3, top + 1]]);
      ret(g, cabelo, cx - 2, top - 6, 4, 4, 1); // coque
    } else if (t === 'monk') {
      elipse(g, mistura(PELE, 0.95), cx, top + 1, 6, 3); // careca
    } else {
      poli(g, cabelo, [[cx - 7, top + 4], [cx - 6, top - 2], [cx + 6, top - 2], [cx + 7, top + 4], [cx + 2, top + 1], [cx - 4, top + 2]]);
    }
    if (t === 'gun') { ret(g, [60, 46, 34], cx - 9, top - 1, 18, 3, 1); ret(g, [60, 46, 34], cx - 5, top - 5, 10, 5, 2); } // chapéu
    // --- armas e acessórios (corpo)
    if (t === 'samurai') linha(g, [210, 236, 255], cx + 13, top + 24, cx + 20, top - 2, 2); // katana
    if (t === 'gun') ret(g, [44, 52, 86], lado ? cx - 18 : cx + 10, top + 19, 9, 4, 1); // pistola
    if (t === 'bio') ret(g, [44, 52, 86], cx - 17, top + 18, 7, 3, 1); // pistola de seringa
  }, (g, q) => {
    const { bob, passo } = pose(q);
    const top = 8 + bob;
    const n = classe.neon;
    // visor (monk tem marcas na testa)
    if (t === 'monk') { luz(g, n, cx - 3, top + 1, 6, 1); }
    else if (lado) luz(g, n, cx - 6, top + 5, 6, 2);
    else luz(g, n, cx - 5, top + 5, 10, 2);
    brilho(g, n, cx, top + 6, 7, 0.45);
    // detalhes neon da roupa
    luz(g, n, cx - 8, top + 17, 16, 1);
    if (t === 'samurai') { luz(g, n, cx + 19, top - 1, 1, 6); brilho(g, n, cx + 17, top + 8, 8, 0.35); }
    if (t === 'gun') { luz(g, n, lado ? cx - 18 : cx + 18, top + 20, 1, 2); }
    if (t === 'net') { brilho(g, n, cx + 15, top + 18, 7, 0.7); luz(g, n, cx + 13, top + 17, 3, 3); luz(g, n, cx - 10, top + 30, 20, 1); }
    if (t === 'bio') { luz(g, n, cx - 11, top + 18, 2, 3); brilho(g, n, cx - 14, top + 19, 6, 0.6); luz(g, n, cx - 10, top + 30, 20, 1); }
    if (t === 'monk') { brilho(g, n, cx - 10, top + 23 + Math.max(0, passo), 6, 0.8); brilho(g, n, cx + 10, top + 23 + Math.max(0, -passo), 6, 0.8); }
  });
}

// ---------------------------------------------------------------- monstros

type Forma = 'inseto' | 'mech' | 'daemon' | 'esqueleto' | 'ciborgue' | 'holograma' | 'fera' | 'bolha' | 'tita';

const FORMA_DA_CLASSE: Record<string, Forma> = {
  Vermin: 'inseto', Construct: 'mech', Demon: 'daemon', Undead: 'esqueleto', Human: 'ciborgue',
  Humanoid: 'ciborgue', Magical: 'holograma', 'Extra Dimensional': 'holograma', Elemental: 'holograma',
  Inkborn: 'holograma', Dragon: 'fera', Reptile: 'fera', Mammal: 'fera', Lycanthrope: 'fera', Bird: 'fera',
  Amphibic: 'bolha', Aquatic: 'bolha', Slime: 'bolha', Plant: 'bolha', Giant: 'tita',
};

export interface MonstroGerado { id: string; classe?: string; grande?: boolean }

export function quadrosMonstro(m: MonstroGerado, direcao: number, andando: boolean): Texture[] {
  const forma = FORMA_DA_CLASSE[m.classe ?? ''] ?? 'mech';
  const h = hash(m.id);
  const matiz = h % 360;
  const neon = hslRgb(matiz, 95, 60);
  const casco = hslRgb(matiz, 35, 30);
  const metal = hslRgb((h >> 9) % 360, 14, 38 + ((h >> 3) % 12));
  const lado = direcao !== DIR_SUL;
  const tam = m.grande || forma === 'tita' ? TAM_GRANDE : TAM;
  const e = tam / TAM; // escala dos grandes
  const cx = tam / 2;
  const base = tam - 3;
  const pose = (q: number) => ({ bob: andando ? (q % 2 ? -1 : 0) : (q ? -1 : 0), passo: andando ? [2, 0, -2, 0][q % 4]! : 0 });
  const olho = (g: Ctx, x: number, y: number) => { luz(g, [255, 255, 255], x, y, 2, 2); };

  return quadros(`mon2:${m.id}:${lado ? 'l' : 'f'}:${andando ? 1 : 0}:${tam}`, tam, andando ? 4 : 2, (g, q) => {
    const { bob, passo } = pose(q);
    sombraChao(g, cx, base, 12 * e);
    switch (forma) {
      case 'inseto': {
        const y = base - 9 + bob;
        for (let i = 0; i < 3; i += 1) {
          const o = (i % 2 ? passo : -passo) / 2;
          linha(g, metal, cx - 6, y - 2 + i * 3, cx - 14, y + 2 + i * 3 + o, 2);
          linha(g, metal, cx + 6, y - 2 + i * 3, cx + 14, y + 2 + i * 3 - o, 2);
        }
        elipse(g, casco, cx, y - 1, 11, 7);
        elipse(g, mistura(casco, 1.25), cx, y - 3, 8, 4);
        elipse(g, metal, lado ? cx - 10 : cx, lado ? y - 2 : y - 7, 5, 4);
        linha(g, metal, lado ? cx - 13 : cx - 3, y - 9, lado ? cx - 16 : cx - 6, y - 14, 1);
        if (!lado) linha(g, metal, cx + 3, y - 9, cx + 6, y - 14, 1);
        break;
      }
      case 'mech':
      case 'tita': {
        const top = base - 34 * e + bob;
        const s = (n: number) => n * e;
        ret(g, metal, cx - s(9) + (lado ? passo : 0), base - s(12), s(6), s(12), 2);
        ret(g, metal, cx + s(3) - (lado ? passo : 0), base - s(12), s(6), s(12), 2);
        ret(g, casco, cx - s(11), top + s(12), s(22), s(14), 4);
        ret(g, metal, cx - s(15), top + s(12), s(5), s(12), 2);
        ret(g, metal, cx + s(10), top + s(12), s(5), s(12), 2);
        ret(g, metal, cx - s(17), top + s(22), s(6), s(5), 2); // punho
        ret(g, metal, cx + s(11), top + s(22), s(6), s(5), 2);
        ret(g, mistura(casco, 0.8), cx - s(7), top + s(2), s(14), s(10), 3); // cabeça
        break;
      }
      case 'daemon': {
        const top = base - 34 + bob;
        poli(g, [40, 14, 30], [[cx - 18, top + 10], [cx - 8, top + 14], [cx - 9, top + 26]]); // asas
        poli(g, [40, 14, 30], [[cx + 18, top + 10], [cx + 8, top + 14], [cx + 9, top + 26]]);
        ret(g, [30, 12, 24], cx - 5 + (lado ? passo : 0), base - 10, 4, 10, 1);
        ret(g, [30, 12, 24], cx + 1 - (lado ? passo : 0), base - 10, 4, 10, 1);
        ret(g, [48, 18, 36], cx - 8, top + 12, 16, 16, 5);
        elipse(g, [48, 18, 36], cx, top + 7, 7, 6);
        poli(g, [200, 50, 70], [[cx - 6, top + 3], [cx - 10, top - 6], [cx - 3, top + 1]]); // chifres
        poli(g, [200, 50, 70], [[cx + 6, top + 3], [cx + 10, top - 6], [cx + 3, top + 1]]);
        linha(g, [48, 18, 36], cx + 6, base - 6, cx + 14, base - 2, 2); // cauda
        break;
      }
      case 'esqueleto': {
        const top = base - 34 + bob;
        const osso: RGB = [205, 214, 232];
        elipse(g, osso, cx, top + 6, 6, 6);
        ret(g, osso, cx - 3, top + 10, 6, 3, 1); // mandíbula
        ret(g, osso, cx - 1, top + 13, 2, 14);
        for (let i = 0; i < 4; i += 1) ret(g, osso, cx - 6, top + 14 + i * 3, 12, 2, 1);
        linha(g, metal, cx - 7, top + 14, cx - 11, top + 26, 2);
        linha(g, metal, cx + 7, top + 14, cx + 11, top + 26, 2);
        linha(g, osso, cx - 2, top + 27, cx - 4 + (lado ? passo : 0), base, 2);
        linha(g, osso, cx + 2, top + 27, cx + 4 - (lado ? passo : 0), base, 2);
        ret(g, metal, cx - 6, top + 25, 12, 3, 1); // bacia cromada
        break;
      }
      case 'ciborgue': {
        const top = base - 36 + bob;
        const roupa = hslRgb((h >> 5) % 360, 45, 34);
        ret(g, [30, 32, 48], cx - 5 + (lado ? passo : 0), top + 23, 4, 13, 1);
        ret(g, [30, 32, 48], cx + 1 - (lado ? passo : 0), top + 23, 4, 13, 1);
        ret(g, roupa, cx - 8, top + 10, 16, 15, 4);
        ret(g, metal, cx - 12, top + 11, 4, 11, 2);
        ret(g, roupa, cx + 8, top + 11, 4, 11, 2);
        elipse(g, PELE, cx, top + 5, 6, 6);
        poli(g, [36, 30, 40], [[cx - 7, top + 4], [cx - 4, top - 3], [cx + 5, top - 3], [cx + 7, top + 3], [cx + 1, top + 1]]);
        ret(g, [44, 52, 86], lado ? cx - 18 : cx + 11, top + 18, 8, 3, 1); // arma
        break;
      }
      case 'holograma': {
        const top = base - 36 + bob * 2;
        g.globalAlpha = 0.9;
        poli(g, mistura(neon, 0.7), [[cx - 9, top + 8], [cx + 9, top + 8], [cx + 12, top + 30], [cx + 6, top + 27], [cx + 2, top + 31], [cx - 3, top + 27], [cx - 8, top + 31], [cx - 12, top + 30]]);
        elipse(g, mistura(neon, 0.85), cx, top + 6, 7, 7);
        g.globalAlpha = 1;
        break;
      }
      case 'fera': {
        const y = base - 15 + bob;
        const pata = (x: number, o: number) => ret(g, metal, x, base - 8 + Math.min(0, o), 3, 8, 1);
        if (lado) {
          pata(cx - 11, passo); pata(cx - 6, -passo); pata(cx + 4, -passo); pata(cx + 9, passo);
          elipse(g, casco, cx, y, 14, 7);
          elipse(g, mistura(casco, 1.2), cx - 1, y - 3, 11, 3);
          elipse(g, casco, cx - 15, y - 4, 7, 6); // cabeça
          poli(g, mistura(casco, 0.8), [[cx - 22, y - 2], [cx - 16, y], [cx - 22, y + 2]]); // focinho
          linha(g, metal, cx + 13, y - 1, cx + 21, y - 6, 2); // cauda
        } else {
          pata(cx - 11, passo); pata(cx + 8, -passo);
          elipse(g, casco, cx, y, 12, 8);
          elipse(g, casco, cx, y - 8, 8, 7);
          poli(g, mistura(casco, 0.75), [[cx - 6, y - 14], [cx - 9, y - 21], [cx - 2, y - 15]]); // orelhas
          poli(g, mistura(casco, 0.75), [[cx + 6, y - 14], [cx + 9, y - 21], [cx + 2, y - 15]]);
          ret(g, metal, cx - 4, y - 5, 8, 4, 2); // mandíbula cromada
        }
        break;
      }
      case 'bolha': {
        const y = base - 11 + bob;
        elipse(g, casco, cx, y, 13, 10 + bob);
        elipse(g, mistura(casco, 1.35), cx - 3, y - 4, 7, 4);
        for (let i = 0; i < 4; i += 1) ret(g, casco, cx - 11 + i * 6, y + 7 + ((q + i) % 2), 3, 5, 1);
        break;
      }
    }
  }, (g, q) => {
    const { bob } = pose(q);
    switch (forma) {
      case 'inseto': {
        const y = base - 9 + bob;
        if (lado) { olho(g, cx - 13, y - 4); brilho(g, neon, cx - 12, y - 3, 6); }
        else { olho(g, cx - 3, y - 8); olho(g, cx + 1, y - 8); brilho(g, neon, cx, y - 7, 6); }
        luz(g, neon, cx - 7, y + 1, 14, 1);
        break;
      }
      case 'mech':
      case 'tita': {
        const top = base - 34 * e + bob;
        luz(g, neon, cx - (lado ? 8 : 5) * e, top + 6 * e, (lado ? 6 : 10) * e, 2 * e);
        brilho(g, neon, cx, top + 7 * e, 8 * e, 0.5);
        luz(g, neon, cx - 9 * e, top + 18 * e, 18 * e, 1);
        brilho(g, neon, cx, top + 19 * e, 6 * e, 0.4); // reator no peito
        break;
      }
      case 'daemon': {
        const top = base - 34 + bob;
        brilho(g, [255, 40, 60], cx, top + 18, 16, 0.35);
        if (lado) luz(g, [255, 210, 60], cx - 5, top + 6, 2, 1);
        else { luz(g, [255, 210, 60], cx - 4, top + 6, 2, 1); luz(g, [255, 210, 60], cx + 2, top + 6, 2, 1); }
        luz(g, neon, cx - 1, top + 16, 2, 6);
        break;
      }
      case 'esqueleto': {
        const top = base - 34 + bob;
        if (lado) olho(g, cx - 4, top + 5);
        else { olho(g, cx - 4, top + 5); olho(g, cx + 2, top + 5); }
        brilho(g, neon, cx, top + 6, 7, 0.6);
        brilho(g, neon, cx, top + 19, 5, 0.5);
        break;
      }
      case 'ciborgue': {
        const top = base - 36 + bob;
        luz(g, neon, lado ? cx - 6 : cx - 5, top + 5, lado ? 6 : 10, 2);
        brilho(g, neon, cx, top + 6, 6, 0.5);
        luz(g, neon, cx - 8, top + 16, 16, 1);
        break;
      }
      case 'holograma': {
        const top = base - 36 + bob * 2;
        brilho(g, neon, cx, top + 16, 18, 0.45);
        for (let y = top; y < top + 32; y += 2) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - 14, y, 28, 1); }
        if (lado) olho(g, cx - 4, top + 5);
        else { olho(g, cx - 4, top + 5); olho(g, cx + 2, top + 5); }
        if (q % 2) luz(g, [255, 255, 255], cx - 10 + ((h >> q) % 18), top + 6 + ((h >> (q + 3)) % 20), 4, 1); // glitch
        break;
      }
      case 'fera': {
        const y = base - 15 + bob;
        if (lado) { olho(g, cx - 17, y - 6); brilho(g, neon, cx - 16, y - 5, 6); luz(g, neon, cx - 8, y - 1, 14, 1); }
        else { olho(g, cx - 4, y - 10); olho(g, cx + 2, y - 10); brilho(g, neon, cx, y - 9, 7); luz(g, neon, cx - 8, y + 2, 16, 1); }
        break;
      }
      case 'bolha': {
        const y = base - 11 + bob;
        brilho(g, neon, cx, y, 13, 0.45);
        if (lado) olho(g, cx - 8, y - 3);
        else { olho(g, cx - 5, y - 3); olho(g, cx + 3, y - 3); }
        luz(g, neon, cx - 9, y + 3, 18, 1);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------- ícones das telas

function paraUrl(t: Texture | undefined, tamanho: number): string | null {
  const origem = t?.source.resource as HTMLCanvasElement | undefined;
  if (!origem) return null;
  const c = document.createElement('canvas');
  c.width = tamanho;
  c.height = tamanho;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(origem, 0, 0, tamanho, tamanho);
  return c.toDataURL('image/png');
}

/** Ícone (data URL) de um monstro gerado, para listas, bestiário e caçadas. */
export function iconeMonstro(m: MonstroGerado, tamanho = 48): string | null {
  return paraUrl(quadrosMonstro(m, DIR_SUL, false)[0], tamanho);
}

/** Ícone (data URL) de um ciborgue gerado, para barra de ações e Outfit. */
export function iconeJogador(j: JogadorGerado, tamanho = 48): string | null {
  return paraUrl(quadrosJogador(j, DIR_SUL, false)[0], tamanho);
}
