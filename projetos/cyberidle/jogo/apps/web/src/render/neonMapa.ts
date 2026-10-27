import { Container, Sprite, Texture } from 'pixi.js';
import type { HuntTheme } from './scenes.js';

/**
 * Cenário neon do Cyberidle - arte PRÓPRIA, gerada por código (nada do cliente original).
 *
 * Cada caçada vira um pedaço de cidade (avenidas, calçadas, fachadas, telhados, carros),
 * com a área de luta num cruzamento. Cada distrito tem a sua cor. As texturas (32x32, estilo pixel) são feitas uma vez num canvas e reaproveitadas.
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

// ---------------------------------------------------------------- rua (versão 2)
// A pedido do dono: estética de RUA, não só placas e luzes no chão. Cada caçada vira um
// pedaço de cidade: avenidas de asfalto com faixas, cruzamentos com faixa de pedestre,
// calçadas com meio-fio, postes e lixo, fachadas de loja com toldo e letreiro, telhados com
// caixas de ar e antenas, e carros estacionados.

const SINAIS = ['#ff3cd2', '#00e5ff', '#ffd23c', '#39ff88', '#ff6b3c'];

function asfalto(variante: number, marca: 'nenhuma' | 'h' | 'v' | 'zebraH' | 'zebraV'): Texture {
  return textura(`asf:${variante}:${marca}`, (g) => {
    const r = rng(variante * 313 + 5);
    g.fillStyle = '#16181f';
    g.fillRect(0, 0, T, T);
    for (let i = 0; i < 40; i += 1) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.04)';
      g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1);
    }
    if (variante % 5 === 1) { // rachadura
      g.fillStyle = '#0b0c11';
      let x = 6 + Math.floor(r() * 18); let y = 4;
      while (y < 28) { g.fillRect(x, y, 1, 2); x += Math.floor(r() * 3) - 1; y += 2; }
    } else if (variante % 5 === 3) { // bueiro
      g.fillStyle = '#0d0f14'; g.beginPath(); g.arc(16, 16, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#262a36'; for (let k = -5; k <= 5; k += 3) g.fillRect(11, 16 + k, 10, 1);
    } else if (variante % 5 === 4) { // poça refletindo neon
      g.fillStyle = 'rgba(8, 12, 26, 0.9)'; g.beginPath(); g.ellipse(14, 20, 10, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255, 60, 210, 0.4)'; g.fillRect(8, 19, 8, 1);
      g.fillStyle = 'rgba(0, 229, 255, 0.35)'; g.fillRect(13, 21, 7, 1);
    }
    g.fillStyle = 'rgba(255, 210, 60, 0.85)';
    if (marca === 'h') { g.fillRect(2, 31, 12, 1); g.fillRect(18, 31, 12, 1); }
    if (marca === 'v') { g.fillRect(31, 2, 1, 12); g.fillRect(31, 18, 1, 12); }
    g.fillStyle = 'rgba(235, 238, 245, 0.7)';
    if (marca === 'zebraH') for (let x = 2; x < T; x += 6) g.fillRect(x, 4, 3, 24);
    if (marca === 'zebraV') for (let y = 2; y < T; y += 6) g.fillRect(4, y, 24, 3);
  });
}

/** Calçada: lajotas, com meio-fio nos lados que dão para a rua (máscara N=1 L=2 S=4 O=8). */
function calcada(mascara: number, variante: number): Texture {
  return textura(`calc:${mascara}:${variante}`, (g) => {
    const r = rng(variante * 71 + 3);
    g.fillStyle = '#2a2e3d';
    g.fillRect(0, 0, T, T);
    g.fillStyle = '#20232f';
    for (let y = 0; y < T; y += 8) g.fillRect(0, y, T, 1);
    for (let y = 0; y < T; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < T; x += 8) g.fillRect(x, y, 1, 8);
    for (let i = 0; i < 14; i += 1) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 1, 1); }
    g.fillStyle = '#585e72';
    if (mascara & 1) g.fillRect(0, 0, T, 2);
    if (mascara & 2) g.fillRect(T - 2, 0, 2, T);
    if (mascara & 4) g.fillRect(0, T - 2, T, 2);
    if (mascara & 8) g.fillRect(0, 0, 2, T);
  });
}

/** Telhado visto de cima, com borda neon onde encosta na calçada e equipamentos. */
function telhado(cor: string, bordas: number, variante: number): Texture {
  return textura(`tel:${cor}:${bordas}:${variante}`, (g) => {
    const r = rng(variante * 197 + 11);
    g.fillStyle = '#0c0e18'; g.fillRect(0, 0, T, T);
    g.fillStyle = '#11142a'; g.fillRect(1, 1, T - 2, T - 2);
    const item = variante % 6;
    if (item === 0) { // caixa de ar-condicionado
      g.fillStyle = '#2a2f45'; g.fillRect(8, 9, 14, 12); g.fillStyle = '#1a1e2e';
      g.beginPath(); g.arc(15, 15, 4, 0, Math.PI * 2); g.fill();
    } else if (item === 1) { // antena
      g.fillStyle = '#3a4060'; g.fillRect(15, 6, 2, 18); g.fillRect(10, 10, 12, 1);
      g.fillStyle = '#ff3b3b'; g.fillRect(15, 5, 2, 2);
    } else if (item === 2) { // claraboia
      g.fillStyle = alfa(cor, 0.25); g.fillRect(9, 9, 14, 14); g.fillStyle = alfa(cor, 0.6); g.fillRect(9, 9, 14, 1);
    } else if (item === 3) { // painel solar
      g.fillStyle = '#1b2a55'; g.fillRect(6, 8, 20, 14);
      g.fillStyle = '#2d4790'; for (let x = 6; x < 26; x += 5) g.fillRect(x, 8, 1, 14);
    }
    for (let i = 0; i < 8; i += 1) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(Math.floor(r() * T), Math.floor(r() * T), 2, 1); }
    g.fillStyle = alfa(cor, 0.9);
    if (bordas & 1) g.fillRect(0, 0, T, 1);
    if (bordas & 2) g.fillRect(T - 1, 0, 1, T);
    if (bordas & 8) g.fillRect(0, 0, 1, T);
  });
}

/** Fachada de loja (prédio com calçada ao sul): parede, vitrine acesa, toldo e letreiro. */
function fachada(cor: string, variante: number): Texture {
  return textura(`fach:${cor}:${variante}`, (g) => {
    const placa = SINAIS[variante % SINAIS.length]!;
    g.fillStyle = '#11142a'; g.fillRect(0, 0, T, 12);
    g.fillStyle = '#1b1f33'; g.fillRect(0, 12, T, 20);
    // letreiro neon
    g.fillStyle = alfa(placa, 0.2); g.fillRect(4, 2, 24, 9);
    g.fillStyle = placa; g.fillRect(5, 3, 22, 1); g.fillRect(5, 9, 22, 1);
    for (let x = 7; x < 25; x += 4) g.fillRect(x, 5, 2, 3);
    // toldo
    g.fillStyle = variante % 2 ? '#5b1a6e' : '#0d4a5a';
    g.fillRect(0, 13, T, 4);
    g.fillStyle = 'rgba(255,255,255,0.15)'; for (let x = 0; x < T; x += 6) g.fillRect(x, 13, 3, 4);
    // vitrine e porta
    if (variante % 3 === 0) {
      g.fillStyle = '#0a0c14'; g.fillRect(12, 19, 8, 13);
      g.fillStyle = alfa(cor, 0.5); g.fillRect(12, 19, 8, 1);
    } else {
      g.fillStyle = alfa(placa, 0.35); g.fillRect(3, 19, 26, 9);
      g.fillStyle = 'rgba(255, 220, 160, 0.25)'; g.fillRect(5, 21, 8, 5); g.fillRect(17, 21, 9, 5);
    }
  });
}

/** Coisas de calçada e de rua. */
function enfeite(tipo: 'poste' | 'lixo' | 'banco' | 'hidrante' | 'carro' | 'cone', variante: number): Texture {
  return textura(`enf:${tipo}:${variante}`, (g) => {
    g.clearRect(0, 0, T, T);
    if (tipo === 'poste') {
      g.fillStyle = 'rgba(0,229,255,0.12)'; g.beginPath(); g.ellipse(16, 24, 12, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3a4060'; g.fillRect(15, 4, 2, 22); g.fillRect(15, 4, 8, 2);
      g.fillStyle = '#bff9ff'; g.fillRect(21, 6, 3, 2);
    } else if (tipo === 'lixo') {
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(9, 25, 14, 3);
      g.fillStyle = '#2e5a3a'; g.fillRect(10, 13, 12, 13); g.fillStyle = '#3f7a50'; g.fillRect(9, 12, 14, 2);
      g.fillStyle = '#c9c9c9'; g.fillRect(20, 24, 4, 2); g.fillStyle = '#8a6a3a'; g.fillRect(6, 26, 3, 2);
    } else if (tipo === 'banco') {
      g.fillStyle = '#3d2f2a'; g.fillRect(5, 15, 22, 4); g.fillStyle = '#2a2f45'; g.fillRect(7, 19, 2, 5); g.fillRect(23, 19, 2, 5);
    } else if (tipo === 'hidrante') {
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(12, 25, 9, 2);
      g.fillStyle = '#b4232f'; g.fillRect(13, 15, 7, 11); g.fillRect(11, 18, 11, 3); g.fillStyle = '#e04050'; g.fillRect(14, 13, 5, 2);
    } else if (tipo === 'cone') {
      g.fillStyle = '#ff7a1a'; g.beginPath(); g.moveTo(16, 10); g.lineTo(21, 25); g.lineTo(11, 25); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(13, 18, 6, 2);
    } else {
      const cores = ['#7a1f3d', '#1f4a7a', '#2f2f3a', '#6a5a1f'];
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(3, 9, 27, 17);
      g.fillStyle = cores[variante % cores.length]!; g.fillRect(2, 8, 27, 15);
      g.fillStyle = '#0d1424'; g.fillRect(8, 10, 6, 11); g.fillRect(19, 10, 5, 11);
      g.fillStyle = '#fff6c0'; g.fillRect(28, 9, 1, 3); g.fillRect(28, 18, 1, 3);
      g.fillStyle = '#ff3b3b'; g.fillRect(2, 9, 1, 3); g.fillRect(2, 18, 1, 3);
    }
  });
}

// ---------------------------------------------------------------- montagem

type Celula = 'rua' | 'calcada' | 'predio';

/**
 * Monta um pedaço de cidade do tamanho da grade (`ground` só dá o tamanho e a semente).
 * Avenidas de 2 faixas passam por cada centro de câmera (onde a luta acontece), com um
 * cruzamento em volta dele; ao lado de toda rua há calçada; o resto são quarteirões.
 */
export function pintarNeon(
  parent: Container,
  ground: number[][],
  _stack: number[][][],
  tema: HuntTheme,
  semente: string,
  centros: Array<[number, number]> = [[Math.floor((ground[0]?.length ?? 13) / 2), Math.floor(ground.length / 2)]],
): void {
  const cor = COR[tema] ?? COR.cave;
  const r = rng(hash(semente));
  const linhas = ground.length;
  const colunas = ground[0]?.length ?? 0;
  const mapa: Celula[][] = Array.from({ length: linhas }, () => Array<Celula>(colunas).fill('predio'));
  // Grade de quarteirões: avenidas de 2 faixas a cada 8 linhas e a cada 9 colunas, alinhadas
  // para o primeiro centro de câmera cair num cruzamento.
  const [c0x, c0y] = centros[0] ?? [Math.floor(colunas / 2), Math.floor(linhas / 2)];
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  const ruaH = new Set<number>();
  const ruaV = new Set<number>();
  for (let y = 0; y < linhas; y += 1) if (mod(y - c0y, 8) <= 1) ruaH.add(y);
  for (let x = 0; x < colunas; x += 1) if (mod(x - c0x + 1, 9) <= 1) ruaV.add(x);
  // As paradas da câmera ficam todas na avenida horizontal do centro (scenes.ts), então não
  // precisa abrir pátio no meio do quarteirão.
  const praca = (_x: number, _y: number) => false;
  for (let y = 0; y < linhas; y += 1) {
    for (let x = 0; x < colunas; x += 1) {
      if (ruaH.has(y) || ruaV.has(x) || praca(x, y)) mapa[y]![x] = 'rua';
    }
  }
  const ehRua = (x: number, y: number) => mapa[y]?.[x] === 'rua';
  for (let y = 0; y < linhas; y += 1) {
    for (let x = 0; x < colunas; x += 1) {
      if (mapa[y]![x] !== 'predio') continue;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (ehRua(x + dx, y + dy)) mapa[y]![x] = 'calcada';
      }
    }
  }
  const tipo = (x: number, y: number): Celula | null => (y < 0 || y >= linhas || x < 0 || x >= colunas ? null : mapa[y]![x]!);

  const chaoC = new Container();
  const enfeites = new Container();
  parent.addChild(chaoC);
  parent.addChild(enfeites);
  const por = (camada: Container, tex: Texture, x: number, y: number) => {
    const s = new Sprite(tex);
    s.x = x * T; s.y = y * T; s.roundPixels = true;
    camada.addChild(s);
  };

  for (let y = 0; y < linhas; y += 1) {
    for (let x = 0; x < colunas; x += 1) {
      const c = mapa[y]![x]!;
      if (c === 'rua') {
        let marca: 'nenhuma' | 'h' | 'v' | 'zebraH' | 'zebraV' = 'nenhuma';
        const emH = ruaH.has(y);
        const emV = ruaV.has(x);
        const cruz = emH && emV;
        if (emH && !emV && (ruaV.has(x - 1) || ruaV.has(x + 1))) marca = 'zebraV';
        else if (emV && !emH && (ruaH.has(y - 1) || ruaH.has(y + 1))) marca = 'zebraH';
        else if (emH && !emV && mod(y - c0y, 8) === 0) marca = 'h';
        else if (emV && !emH && mod(x - c0x + 1, 9) === 0) marca = 'v';
        // asfalto liso na maior parte; rachadura, bueiro e poça de vez em quando
        const sorteio = r();
        const variante = sorteio < 0.8 ? (sorteio < 0.4 ? 0 : 2) : sorteio < 0.88 ? 1 : sorteio < 0.94 ? 3 : 4;
        por(chaoC, asfalto(variante, marca), x, y);
        // carro estacionado na beira da avenida, fora do cruzamento
        if (!cruz && !praca(x, y) && r() < 0.06 && (tipo(x, y - 1) === 'calcada' || tipo(x, y + 1) === 'calcada')) {
          por(enfeites, enfeite('carro', Math.floor(r() * 4)), x, y);
        } else if (!cruz && !praca(x, y) && r() < 0.015) {
          por(enfeites, enfeite('cone', 0), x, y);
        }
      } else if (c === 'calcada') {
        const m = (tipo(x, y - 1) === 'rua' ? 1 : 0) | (tipo(x + 1, y) === 'rua' ? 2 : 0)
          | (tipo(x, y + 1) === 'rua' ? 4 : 0) | (tipo(x - 1, y) === 'rua' ? 8 : 0);
        por(chaoC, calcada(m, Math.floor(r() * 4)), x, y);
        const sorte = r();
        if (m && (x + y) % 4 === 0) por(enfeites, enfeite('poste', 0), x, y);
        else if (sorte < 0.06) por(enfeites, enfeite('lixo', 0), x, y);
        else if (sorte < 0.09) por(enfeites, enfeite('banco', 0), x, y);
        else if (sorte < 0.11) por(enfeites, enfeite('hidrante', 0), x, y);
      } else {
        // prédio: fachada se a calçada fica logo abaixo; senão telhado
        if (tipo(x, y + 1) === 'calcada') {
          por(chaoC, fachada(cor, Math.floor(r() * 10)), x, y);
        } else {
          const b = (tipo(x, y - 1) === 'calcada' ? 1 : 0) | (tipo(x + 1, y) === 'calcada' ? 2 : 0) | (tipo(x - 1, y) === 'calcada' ? 8 : 0);
          por(chaoC, telhado(cor, b, Math.floor(r() * 12)), x, y);
        }
      }
    }
  }
}
