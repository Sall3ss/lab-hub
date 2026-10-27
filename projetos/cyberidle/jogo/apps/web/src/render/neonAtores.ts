import { Texture } from 'pixi.js';

/**
 * Monstros e personagens do Cyberidle - arte PRÓPRIA gerada por código (nada do cliente
 * original), no mesmo estilo pixel/neon dos mapas (neonMapa.ts).
 *
 * Monstro: o formato vem da classe do bestiário (inseto-drone, mech, daemon, esqueleto
 * cromado, ciborgue, holograma, mecha-fera, bolha tóxica, titã) e a cor de um hash do id,
 * então cada espécie tem sempre a mesma cara. Personagem: ciborgue com o visual da classe
 * (Street Samurai, Gunslinger, Netrunner, Biohacker, Cyber Monk) e as cores do Outfit.
 * Quadros: parado (2, respirando) e andando (4), de frente (sul) e de lado (oeste; leste é o
 * espelho, feito pela cena). Lab Hub, Claude (Opus 5.5), 27/10/2026.
 */

const DIR_SUL = 2;

type Ctx = CanvasRenderingContext2D;

function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h) % 360}, ${s}%, ${l}%)`;
}

const cache = new Map<string, Texture[]>();

function quadros(chave: string, tamanho: number, n: number, desenhar: (g: Ctx, quadro: number) => void): Texture[] {
  const pronto = cache.get(chave);
  if (pronto && pronto.every((t) => !t.destroyed)) return pronto;
  const lista: Texture[] = [];
  for (let q = 0; q < n; q += 1) {
    const c = document.createElement('canvas');
    c.width = tamanho;
    c.height = tamanho;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    desenhar(g, q);
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    lista.push(t);
  }
  cache.set(chave, lista);
  return lista;
}

const px = (g: Ctx, cor: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = cor; g.fillRect(x, y, w, h); };

function sombra(g: Ctx, cx: number, base: number, larg: number) {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(cx, base - 1, larg, 2.5, 0, 0, Math.PI * 2);
  g.fill();
}

function brilho(g: Ctx, cor: string, x: number, y: number, raio: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, raio);
  grad.addColorStop(0, cor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(x - raio, y - raio, raio * 2, raio * 2);
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
  const cor = hsl(h % 360, 85, 58);
  const corEscura = hsl(h % 360, 45, 22);
  const metal = hsl((h >> 9) % 360, 12, 30 + ((h >> 3) % 10));
  const lado = direcao !== DIR_SUL;
  const tam = m.grande || forma === 'tita' ? 48 : 32;
  const n = andando ? 4 : 2;
  return quadros(`mon:${m.id}:${lado ? 'l' : 'f'}:${andando ? 1 : 0}`, tam, n, (g, q) => {
    const cx = tam / 2;
    const base = tam - 2;
    const bob = andando ? (q % 2 ? -1 : 0) : (q ? -1 : 0);
    const passo = andando ? (q % 4 < 2 ? 1 : -1) : 0;
    sombra(g, cx, base, tam / 4);
    switch (forma) {
      case 'inseto': {
        const y = base - 9 + bob;
        for (let i = -1; i <= 1; i += 1) {
          px(g, metal, cx - 10, y + 2 + i * 3 + (i === passo ? -1 : 0), 4, 1);
          px(g, metal, cx + 6, y + 2 + i * 3 + (i === -passo ? -1 : 0), 4, 1);
        }
        px(g, corEscura, cx - 7, y - 3, 14, 9);
        px(g, metal, cx - 6, y - 4, 12, 2);
        px(g, cor, cx - 6, y + 1, 12, 1);
        brilho(g, cor, lado ? cx - 6 : cx, y - 1, 4);
        px(g, '#ffffff', lado ? cx - 7 : cx - 2, y - 1, 2, 1);
        if (!lado) px(g, '#ffffff', cx + 1, y - 1, 2, 1);
        break;
      }
      case 'mech':
      case 'tita': {
        const e = forma === 'tita' ? 1.5 : 1;
        const top = base - Math.round(24 * e) + bob;
        const w = Math.round(12 * e);
        px(g, metal, cx - w / 2 - 1, base - Math.round(9 * e) + (passo > 0 ? -1 : 0), Math.round(3 * e), Math.round(9 * e));
        px(g, metal, cx + w / 2 - Math.round(2 * e), base - Math.round(9 * e) + (passo < 0 ? -1 : 0), Math.round(3 * e), Math.round(9 * e));
        px(g, corEscura, cx - w / 2, top + Math.round(6 * e), w, Math.round(10 * e));
        px(g, metal, cx - w / 2 - 2, top + Math.round(7 * e), 2, Math.round(7 * e));
        px(g, metal, cx + w / 2, top + Math.round(7 * e), 2, Math.round(7 * e));
        px(g, cor, cx - w / 2, top + Math.round(10 * e), w, 1);
        px(g, metal, cx - Math.round(4 * e), top, Math.round(8 * e), Math.round(6 * e));
        brilho(g, cor, cx + (lado ? -2 : 0), top + 3, 5 * e);
        px(g, cor, lado ? cx - Math.round(4 * e) : cx - Math.round(3 * e), top + 2, lado ? Math.round(4 * e) : Math.round(6 * e), 2);
        break;
      }
      case 'daemon': {
        const top = base - 24 + bob;
        brilho(g, 'rgba(255,40,60,0.6)', cx, top + 12, 12);
        px(g, '#1a0b14', cx - 6, top + 6, 12, 14);
        px(g, '#1a0b14', cx - 4, base - 6, 3, 6 + (passo > 0 ? -1 : 0));
        px(g, '#1a0b14', cx + 1, base - 6, 3, 6 + (passo < 0 ? -1 : 0));
        px(g, cor, cx - 6, top + 12, 12, 1);
        px(g, '#24101c', cx - 4, top, 8, 7);
        px(g, '#ff3b3b', cx - 6, top - 3, 2, 4); px(g, '#ff3b3b', cx + 4, top - 3, 2, 4);
        px(g, '#ffd23c', lado ? cx - 4 : cx - 3, top + 3, 2, 1);
        if (!lado) px(g, '#ffd23c', cx + 1, top + 3, 2, 1);
        px(g, corEscura, cx - 11, top + 6, 5, 8); px(g, corEscura, cx + 6, top + 6, 5, 8);
        break;
      }
      case 'esqueleto': {
        const top = base - 24 + bob;
        const osso = '#c9d3e8';
        px(g, osso, cx - 4, top, 8, 7);
        px(g, '#0b0d16', lado ? cx - 3 : cx - 3, top + 2, 2, 2);
        if (!lado) px(g, '#0b0d16', cx + 1, top + 2, 2, 2);
        brilho(g, cor, cx - 1, top + 3, 3);
        px(g, osso, cx - 1, top + 7, 2, 10);
        for (let i = 0; i < 3; i += 1) px(g, osso, cx - 5, top + 9 + i * 2, 10, 1);
        px(g, cor, cx - 5, top + 15, 10, 1);
        px(g, osso, cx - 3, base - 7, 1, 7 + (passo > 0 ? -1 : 0));
        px(g, osso, cx + 2, base - 7, 1, 7 + (passo < 0 ? -1 : 0));
        px(g, metal, cx - 8, top + 8, 2, 7); px(g, metal, cx + 6, top + 8, 2, 7);
        break;
      }
      case 'ciborgue': {
        const top = base - 25 + bob;
        px(g, corEscura, cx - 3, base - 8, 2, 8 + (passo > 0 ? -1 : 0));
        px(g, corEscura, cx + 1, base - 8, 2, 8 + (passo < 0 ? -1 : 0));
        px(g, hsl((h >> 5) % 360, 50, 32), cx - 5, top + 7, 10, 11);
        px(g, metal, cx - 7, top + 8, 2, 8); px(g, metal, cx + 5, top + 8, 2, 8);
        px(g, cor, cx - 5, top + 12, 10, 1);
        px(g, '#d6a27c', cx - 3, top + 1, 6, 6);
        px(g, '#1a1d2b', cx - 4, top, 8, 2);
        px(g, cor, lado ? cx - 4 : cx - 3, top + 3, lado ? 4 : 6, 1);
        brilho(g, cor, cx, top + 3, 3);
        px(g, '#2c3556', cx + (lado ? -9 : 6), top + 11, 4, 2);
        break;
      }
      case 'holograma': {
        const top = base - 26 + bob * 2;
        brilho(g, cor, cx, top + 12, 13);
        g.globalAlpha = 0.85;
        px(g, cor, cx - 6, top + 4, 12, 16);
        px(g, cor, cx - 4, top, 8, 4);
        px(g, cor, cx - 8, top + 20, 4, 3); px(g, cor, cx - 2, top + 21, 4, 3); px(g, cor, cx + 4, top + 20, 4, 3);
        g.globalAlpha = 1;
        for (let y = top; y < top + 24; y += 2) px(g, 'rgba(0,0,0,0.35)', cx - 9, y, 18, 1);
        px(g, '#ffffff', lado ? cx - 4 : cx - 3, top + 6, 2, 2);
        if (!lado) px(g, '#ffffff', cx + 1, top + 6, 2, 2);
        if (q % 2) px(g, '#ffffff', cx - 8 + ((h >> q) % 14), top + 4 + ((h >> (q + 3)) % 16), 3, 1); // glitch
        break;
      }
      case 'fera': {
        const y = base - 13 + bob;
        px(g, metal, cx - 9, base - 5, 2, 5 + (passo > 0 ? -1 : 0)); px(g, metal, cx - 5, base - 5, 2, 5 + (passo < 0 ? -1 : 0));
        px(g, metal, cx + 3, base - 5, 2, 5 + (passo < 0 ? -1 : 0)); px(g, metal, cx + 7, base - 5, 2, 5 + (passo > 0 ? -1 : 0));
        px(g, corEscura, cx - 10, y, 20, 8);
        px(g, metal, cx - 10, y, 20, 2);
        px(g, cor, cx - 8, y + 4, 16, 1);
        px(g, corEscura, lado ? cx - 15 : cx - 4, y - 5, lado ? 7 : 8, 7);
        px(g, '#e8e8e8', lado ? cx - 15 : cx - 3, y + 1, lado ? 4 : 6, 1);
        px(g, cor, lado ? cx - 14 : cx - 3, y - 3, 2, 1);
        if (!lado) px(g, cor, cx + 1, y - 3, 2, 1);
        brilho(g, cor, lado ? cx - 13 : cx, y - 3, 4);
        px(g, metal, cx + 10, y + 1, 5, 2); px(g, cor, cx + 14, y, 2, 2);
        break;
      }
      default: { // bolha / planta / aquático
        const y = base - 10 + bob;
        g.fillStyle = corEscura; g.beginPath(); g.ellipse(cx, y, 10, 8 - bob, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = cor; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(cx - 2, y - 2, 6, 4, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        brilho(g, cor, cx, y, 9);
        for (let i = 0; i < 4; i += 1) px(g, corEscura, cx - 8 + i * 5, y + 6 + ((q + i) % 2), 2, 3);
        px(g, '#ffffff', lado ? cx - 6 : cx - 3, y - 3, 2, 2);
        if (!lado) px(g, '#ffffff', cx + 2, y - 3, 2, 2);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------- personagens

export interface JogadorGerado { vocationId: number; corCorpo?: [number, number, number]; corPernas?: [number, number, number]; corCabeca?: [number, number, number] }

const rgb = (c: [number, number, number] | undefined, padrao: string) => (c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : padrao);

/** Cor neon e acessório de cada classe. */
const CLASSE: Record<number, { neon: string; tipo: 'samurai' | 'gun' | 'net' | 'bio' | 'monk' }> = {
  4: { neon: '#ff3cd2', tipo: 'samurai' }, 8: { neon: '#ff3cd2', tipo: 'samurai' },
  3: { neon: '#ffd23c', tipo: 'gun' }, 7: { neon: '#ffd23c', tipo: 'gun' },
  1: { neon: '#00e5ff', tipo: 'net' }, 5: { neon: '#00e5ff', tipo: 'net' },
  2: { neon: '#39ff88', tipo: 'bio' }, 6: { neon: '#39ff88', tipo: 'bio' },
  9: { neon: '#ff9a3c', tipo: 'monk' }, 10: { neon: '#ff9a3c', tipo: 'monk' },
};

export function quadrosJogador(j: JogadorGerado, direcao: number, andando: boolean): Texture[] {
  const classe = CLASSE[j.vocationId] ?? CLASSE[4]!;
  const corpo = rgb(j.corCorpo, '#3a2f6e');
  const pernas = rgb(j.corPernas, '#1f2440');
  const cabelo = rgb(j.corCabeca, '#1a1d2b');
  const lado = direcao !== DIR_SUL;
  const chave = `jog:${j.vocationId}:${corpo}:${pernas}:${cabelo}:${lado ? 'l' : 'f'}:${andando ? 1 : 0}`;
  return quadros(chave, 32, andando ? 4 : 2, (g, q) => {
    const cx = 16;
    const base = 30;
    const bob = andando ? (q % 2 ? -1 : 0) : (q ? -1 : 0);
    const passo = andando ? (q % 4 < 2 ? 1 : -1) : 0;
    const top = base - 26 + bob;
    sombra(g, cx, base, 7);
    // pernas e botas
    px(g, pernas, cx - 3, base - 9, 2, 9 + (passo > 0 ? -1 : 0));
    px(g, pernas, cx + 1, base - 9, 2, 9 + (passo < 0 ? -1 : 0));
    px(g, '#0d0f18', cx - 3, base - 2 + (passo > 0 ? -1 : 0), 3, 2);
    px(g, '#0d0f18', cx + 1, base - 2 + (passo < 0 ? -1 : 0), 3, 2);
    // tronco (jaqueta na cor do Outfit) e braços cromados
    px(g, corpo, cx - 5, top + 8, 10, 10);
    px(g, '#7d8aa8', cx - 7, top + 9, 2, 7);
    px(g, '#7d8aa8', cx + 5, top + 9, 2, 7);
    px(g, classe.neon, cx - 5, top + 13, 10, 1);
    if (classe.tipo === 'net' || classe.tipo === 'bio') px(g, corpo, cx - 6, top + 17, 12, 4); // casaco longo
    // cabeça
    px(g, '#d6a27c', cx - 3, top + 2, 6, 6);
    px(g, cabelo, cx - 4, top, 8, 3);
    if (classe.tipo === 'net') px(g, '#1a1d2b', cx - 5, top, 10, 5); // capuz
    // visor
    px(g, classe.neon, lado ? cx - 4 : cx - 3, top + 4, lado ? 4 : 6, 1);
    brilho(g, classe.neon, cx, top + 4, 4);
    // acessório da classe
    if (classe.tipo === 'samurai') { px(g, '#d0f6ff', cx + 6, top + 2, 1, 16); px(g, classe.neon, cx + 6, top + 2, 1, 3); }
    if (classe.tipo === 'gun') { px(g, '#2c3556', cx + (lado ? -11 : 6), top + 12, 6, 2); px(g, classe.neon, cx + (lado ? -11 : 11), top + 12, 1, 1); }
    if (classe.tipo === 'net') { brilho(g, classe.neon, cx + 8, top + 15, 4); px(g, classe.neon, cx + 7, top + 14, 2, 2); }
    if (classe.tipo === 'bio') { px(g, '#39ff88', cx - 9, top + 13, 2, 3); brilho(g, '#39ff88', cx - 8, top + 14, 3); }
    if (classe.tipo === 'monk') { px(g, classe.neon, cx - 7, top + 15, 2, 2); px(g, classe.neon, cx + 5, top + 15, 2, 2); }
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
