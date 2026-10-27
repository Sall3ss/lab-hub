import { Container, Sprite, Texture } from 'pixi.js';
import type { HuntTheme } from './scenes.js';

/**
 * Cenário neon do Cyberidle - arte PRÓPRIA, gerada por código (nada do cliente original).
 *
 * Usa só o FORMATO de cada caçada (onde havia chão, onde havia parede, onde havia objetos)
 * e desenha por cima: placas de metal, grades, poças com reflexo, faixas de luz, prédios com
 * janelas acesas e objetos de rua (caixas, barris, terminais, postes). Cada distrito tem a
 * sua cor. As texturas (32x32, estilo pixel) são feitas uma vez num canvas e reaproveitadas.
 * Lab Hub, Claude (Opus 5.5), 27/10/2026.
 */

const T = 32;

/** Cor neon de cada tema de caçada (distrito). */
const COR: Record<HuntTheme, string> = {
  cave: '#00e5ff', swamp: '#39ff88', desert: '#ff9a3c', jungle: '#a6ff3c', ice: '#9fe8ff', sea: '#3d8bff',
  hell: '#ff3b3b', tomb: '#b06bff', city: '#ff3cd2', hive: '#ffd23c', otherworld: '#8a5cff', ruins: '#ffb347',
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return h >>> 0;
}

function alfa(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const cache = new Map<string, Texture>();

function textura(chave: string, desenhar: (g: CanvasRenderingContext2D) => void): Texture {
  const pronta = cache.get(chave);
  if (pronta && !pronta.destroyed) return pronta;
  const canvas = document.createElement('canvas');
  canvas.width = T;
  canvas.height = T;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  desenhar(g);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  cache.set(chave, tex);
  return tex;
}

// ---------------------------------------------------------------- peças

/** Chão: placa de metal com emendas e rebites; variações com grade, poça e faixa de luz. */
function chao(cor: string, variante: number): Texture {
  return textura(`chao:${cor}:${variante}`, (g) => {
    const r = rng(variante * 977 + 13);
    g.fillStyle = variante % 2 ? '#131726' : '#151a2b';
    g.fillRect(0, 0, T, T);
    // ruído de sujeira
    for (let i = 0; i < 22; i += 1) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.03)';
      g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1 + Math.floor(r() * 2), 1);
    }
    // emendas
    g.fillStyle = '#0a0d17';
    g.fillRect(0, 0, T, 1);
    g.fillRect(0, 0, 1, T);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(1, 1, T - 1, 1);
    // rebites
    g.fillStyle = '#2a3150';
    for (const [x, y] of [[3, 3], [T - 4, 3], [3, T - 4], [T - 4, T - 4]]) g.fillRect(x!, y!, 1, 1);
    const tipo = variante % 7;
    if (tipo === 3) {
      // grade de ventilação
      g.fillStyle = '#0b0e18';
      g.fillRect(8, 8, 16, 16);
      g.fillStyle = '#232a45';
      for (let y = 9; y < 24; y += 3) g.fillRect(9, y, 14, 1);
      g.fillStyle = alfa(cor, 0.18);
      g.fillRect(8, 8, 16, 16);
    } else if (tipo === 5) {
      // poça com reflexo neon
      g.fillStyle = 'rgba(10, 14, 30, 0.9)';
      g.beginPath();
      g.ellipse(16, 18, 11, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = alfa(cor, 0.35);
      g.fillRect(9, 17, 10, 1);
      g.fillRect(13, 19, 8, 1);
      g.fillStyle = 'rgba(255, 60, 210, 0.25)';
      g.fillRect(17, 15, 5, 1);
    } else if (tipo === 6) {
      // faixa de luz no chão
      g.fillStyle = alfa(cor, 0.12);
      g.fillRect(0, 14, T, 4);
      g.fillStyle = alfa(cor, 0.85);
      g.fillRect(0, 15, T, 2);
    }
  });
}

/** Parede/prédio: concreto escuro com janelas acesas e linha neon no topo. */
function parede(cor: string, variante: number, topo: boolean): Texture {
  return textura(`parede:${cor}:${variante}:${topo ? 1 : 0}`, (g) => {
    const r = rng(variante * 131 + 7);
    g.fillStyle = '#080a13';
    g.fillRect(0, 0, T, T);
    g.fillStyle = '#0d1020';
    g.fillRect(1, 1, T - 2, T - 2);
    // janelas
    for (let y = 4; y < T - 3; y += 7) {
      for (let x = 3; x < T - 3; x += 7) {
        const acesa = r();
        g.fillStyle = acesa < 0.18 ? alfa(cor, 0.9) : acesa < 0.3 ? 'rgba(255, 214, 120, 0.75)' : '#05060c';
        g.fillRect(x, y, 4, 3);
      }
    }
    if (topo) {
      g.fillStyle = alfa(cor, 0.9);
      g.fillRect(0, 0, T, 1);
      g.fillStyle = alfa(cor, 0.25);
      g.fillRect(0, 1, T, 2);
    }
  });
}

/** Objetos de rua (decoração por cima do chão). */
function objeto(cor: string, tipo: number): Texture {
  return textura(`obj:${cor}:${tipo}`, (g) => {
    g.clearRect(0, 0, T, T);
    switch (tipo % 6) {
      case 0: // caixa com faixa neon
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(8, 25, 18, 3);
        g.fillStyle = '#262c45'; g.fillRect(7, 12, 18, 14);
        g.fillStyle = '#323a5c'; g.fillRect(7, 12, 18, 3);
        g.fillStyle = alfa(cor, 0.9); g.fillRect(7, 19, 18, 1);
        g.fillStyle = '#1a1f33'; g.fillRect(15, 15, 2, 10);
        break;
      case 1: // barril tóxico
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(10, 26, 12, 3);
        g.fillStyle = '#2b3350'; g.fillRect(10, 11, 12, 16);
        g.fillStyle = '#39ff88'; g.fillRect(10, 15, 12, 1); g.fillRect(10, 22, 12, 1);
        g.fillStyle = 'rgba(57,255,136,0.35)'; g.fillRect(12, 9, 8, 2);
        break;
      case 2: // terminal com tela
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(9, 27, 14, 3);
        g.fillStyle = '#1d2238'; g.fillRect(10, 8, 12, 20);
        g.fillStyle = alfa(cor, 0.85); g.fillRect(12, 10, 8, 6);
        g.fillStyle = alfa(cor, 0.3); g.fillRect(12, 18, 8, 1); g.fillRect(12, 20, 6, 1);
        break;
      case 3: // poste com luz
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(13, 28, 8, 2);
        g.fillStyle = '#2a3150'; g.fillRect(15, 6, 2, 22);
        g.fillStyle = alfa(cor, 0.95); g.fillRect(13, 4, 6, 3);
        g.fillStyle = alfa(cor, 0.18); g.fillRect(9, 7, 14, 8);
        break;
      case 4: // cabos e tubo
        g.fillStyle = '#1b2034'; g.fillRect(2, 20, 28, 4);
        g.fillStyle = '#2c3456'; g.fillRect(2, 20, 28, 1);
        g.fillStyle = 'rgba(255,60,210,0.8)'; g.fillRect(6, 25, 10, 1);
        g.fillStyle = alfa(cor, 0.8); g.fillRect(18, 26, 9, 1);
        break;
      default: // placa neon no chão (holograma)
        g.fillStyle = alfa(cor, 0.12); g.fillRect(6, 6, 20, 20);
        g.strokeStyle = alfa(cor, 0.8); g.lineWidth = 1; g.strokeRect(7.5, 7.5, 17, 17);
        g.fillStyle = alfa(cor, 0.8); g.fillRect(12, 15, 8, 2);
        break;
    }
  });
}

// ---------------------------------------------------------------- montagem

/**
 * Pinta a grade (ground[y][x] != 0 = chão; 0 = prédio; stack com algo = objeto de rua) em
 * `parent`, a partir da posição (0,0) do container.
 */
export function pintarNeon(
  parent: Container,
  ground: number[][],
  stack: number[][][],
  tema: HuntTheme,
  semente: string,
  /** Centros de câmera (em células desta grade): ao redor deles a rua fica livre para a luta. */
  centros: Array<[number, number]> = [[Math.floor((ground[0]?.length ?? 13) / 2), Math.floor(ground.length / 2)]],
): void {
  const cor = COR[tema] ?? COR.cave;
  const r = rng(hash(semente));
  const linhas = ground.length;
  const colunas = ground[0]?.length ?? 0;
  const camadaChao = new Container();
  const camadaObj = new Container();
  parent.addChild(camadaChao);
  parent.addChild(camadaObj);
  // Área de luta: perto de qualquer centro de câmera, sempre rua livre.
  const livre = (x: number, y: number) => centros.some(([cx, cy]) => Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 2);
  // Prédio onde o mapa original não tinha chão OU tinha algo em cima (parede de caverna,
  // rocha, árvore) - fora da área de luta.
  const ehChao = (x: number, y: number) =>
    livre(x, y) || (Boolean(ground[y]?.[x]) && (stack[y]?.[x]?.length ?? 0) === 0);
  let total = 0;
  for (let y = 0; y < linhas; y += 1) for (let x = 0; x < colunas; x += 1) if (ehChao(x, y)) total += 1;
  // Sala sem recorte (quase só prédio ou quase só rua): rua com quarteirões nas bordas.
  const tudoRua = total < linhas * colunas * 0.2;

  for (let y = 0; y < linhas; y += 1) {
    for (let x = 0; x < colunas; x += 1) {
      const rua = tudoRua || ehChao(x, y);
      let tex: Texture;
      if (rua) {
        const sorteio = r();
        const variante = sorteio < 0.06 ? 3 : sorteio < 0.1 ? 5 : sorteio < 0.13 ? 6 : Math.floor(r() * 3) * 2;
        tex = chao(cor, variante);
      } else {
        const topo = y + 1 < linhas && (tudoRua || ehChao(x, y + 1));
        tex = parede(cor, Math.floor(r() * 6), topo);
      }
      const s = new Sprite(tex);
      s.x = x * T;
      s.y = y * T;
      s.roundPixels = true;
      camadaChao.addChild(s);
      // objetos de rua espalhados, nunca na área de luta
      if (rua && !livre(x, y) && r() < 0.1) {
        const o = new Sprite(objeto(cor, Math.floor(r() * 6)));
        o.x = x * T;
        o.y = y * T;
        o.roundPixels = true;
        camadaObj.addChild(o);
      }
    }
  }
}
