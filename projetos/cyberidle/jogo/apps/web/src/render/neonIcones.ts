import { acabamento, brilho, elipse, hash, hslRgb, linha, luz, mistura, poli, ret, type Ctx, type RGB } from './pixelArte.js';

/**
 * Ícones de itens do Cyberidle - arte PRÓPRIA gerada por código, no lugar dos ícones do
 * cliente original. São 14 mil itens, então o desenho sai da categoria (arma, armadura,
 * poção, runa, loot...) e o item ganha cor e brilho pelos próprios dados: elemento pelo nome
 * (fogo laranja, gelo ciano, energia amarela...), matiz pelo id quando não tem elemento, e
 * brilho mais forte quanto mais forte o item. Mesmo acabamento de pixel art dos personagens.
 * Lab Hub, Claude (Opus 5.5), 28/10/2026.
 */

export interface ItemDesenho {
  id: number;
  name: string;
  nomeOriginal?: string;
  type?: string | null;
  slot?: string | null;
  weaponType?: string | null;
  ammoType?: string | null;
  runeSpellName?: string | null;
  attack?: number;
  defense?: number;
  armor?: number;
  levelRequired?: number;
}

type Categoria =
  | 'espada' | 'machado' | 'martelo' | 'maca' | 'soco' | 'arco' | 'besta' | 'lanca' | 'estrela'
  | 'dardo' | 'bala' | 'varinha' | 'cajado' | 'datapad' | 'escudo' | 'armadura' | 'capacete'
  | 'calca' | 'bota' | 'anel' | 'colar' | 'mochila' | 'pocao' | 'chip' | 'comida' | 'gema'
  | 'perola' | 'moeda' | 'capsula' | 'engrenagem' | 'placa' | 'ferramenta' | 'nucleo'
  | 'pergaminho' | 'luz' | 'fragmento';

const TAM = 32;
const METAL: RGB = [150, 160, 186];
const ESCURO: RGB = [48, 54, 80];
const CABO: RGB = [70, 52, 44];

const tem = (nome: string, ...palavras: string[]) => palavras.some((p) => nome.includes(p));

function categoria(item: ItemDesenho, nome: string): Categoria {
  const tipo = item.type ?? '';
  if (/\bcoins?\b/.test(nome)) return 'moeda';
  switch (item.weaponType) {
    case 'sword': return 'espada';
    case 'axe': return 'machado';
    case 'club': return tem(nome, 'hammer', 'sledge') ? 'martelo' : 'maca';
    case 'fist': return 'soco';
    case 'wand': return tem(nome, 'rod') ? 'cajado' : 'varinha';
    case 'spellbook': return 'datapad';
    case 'shield': return 'escudo';
    case 'ammunition': return item.ammoType === 'bolt' || tem(nome, 'bolt') ? 'bala' : 'dardo';
    case 'distance':
      if (tem(nome, 'crossbow', 'arbalest', 'ballista')) return 'besta';
      if (tem(nome, 'bow')) return 'arco';
      if (tem(nome, 'star')) return 'estrela';
      return 'lanca';
    default: break;
  }
  switch (item.slot) {
    case 'armor': return 'armadura';
    case 'head': return 'capacete';
    case 'legs': return 'calca';
    case 'feet': return 'bota';
    case 'ring': return 'anel';
    case 'necklace': return 'colar';
    case 'backpack': return 'mochila';
    case 'ammo': return tem(nome, 'bolt') ? 'bala' : 'dardo';
    default: break;
  }
  if (item.runeSpellName || tipo.endsWith('runes') || tem(nome, ' rune')) return 'chip';
  if (tipo === 'liquids' || tipo === 'fluid containers' || tem(nome, 'potion', 'flask', 'vial', 'elixir')) return 'pocao';
  if (tipo === 'food' || tipo === 'mushrooms' || tipo === 'kitchen tools') return 'comida';
  if (tipo === 'containers' || tipo === 'quivers' || tem(nome, 'bag', 'backpack', 'pouch')) return 'mochila';
  if (tipo === 'soul cores' || tem(nome, 'soul orb', 'soul core')) return 'nucleo';
  if (tipo === 'valuables' || tipo === 'metals') {
    if (tem(nome, 'pearl')) return 'perola';
    if (tem(nome, 'token', 'medal', 'coin')) return 'moeda';
    return 'gema';
  }
  if (tipo === 'soul cores' || tipo === 'magical items' || tipo === 'enchanted items' || tem(nome, 'soul', 'orb', 'sphere', 'core')) return 'nucleo';
  if (tipo === 'documents and papers' || tipo === 'books' || tem(nome, 'scroll', 'letter', 'book', 'map', 'parchment')) return 'pergaminho';
  if (tipo === 'light sources' || tem(nome, 'torch', 'candle', 'lamp', 'lantern')) return 'luz';
  if (tipo.startsWith('tools') || tem(nome, 'pick', 'shovel', 'rope', 'machete', 'crowbar', 'hammer')) return 'ferramenta';
  if (tem(nome, 'gem', 'diamond', 'ruby', 'sapphire', 'emerald', 'amethyst', 'topaz', 'crystal', 'shard')) return 'gema';
  if (tipo === 'creature products' || tipo === 'trophies' || tipo === 'quest items' || tipo === 'taming items' || tipo === 'plants and herbs') {
    if (tem(nome, 'blood', 'venom', 'extract', 'tears', 'slime', 'essence', 'fluid', 'goo')) return 'capsula';
    return (['capsula', 'engrenagem', 'placa'] as const)[hash(nome) % 3]!;
  }
  return 'fragmento';
}

/** Matiz do neon: elemento pelo nome, senão pelo id. */
function matiz(item: ItemDesenho, nome: string): number {
  if (tem(nome, 'fire', 'flame', 'magma', 'lava', 'burn', 'hell', 'inferno', 'ember', 'blaze')) return 22;
  if (tem(nome, 'ice', 'frost', 'frozen', 'glacier', 'snow', 'cold', 'arctic')) return 192;
  if (tem(nome, 'energy', 'thunder', 'storm', 'lightning', 'spark', 'volt', 'shock')) return 56;
  if (tem(nome, 'earth', 'terra', 'poison', 'venom', 'nature', 'toxic', 'swamp', 'leaf', 'emerald', 'jungle')) return 125;
  if (tem(nome, 'holy', 'divine', 'sacred', 'sun', 'golden', 'gold', 'royal', 'topaz')) return 46;
  if (tem(nome, 'death', 'blood', 'demon', 'vampire', 'necro', 'cursed', 'skull', 'ruby', 'red')) return 345;
  if (tem(nome, 'shadow', 'dark', 'void', 'amethyst', 'violet', 'purple')) return 280;
  if (tem(nome, 'sapphire', 'blue', 'mana', 'water', 'sea', 'ocean')) return 215;
  return hash(`item${item.id}`) % 360;
}

/** 0..1: quão forte o item é (mais brilho). */
function forca(item: ItemDesenho): number {
  const valor = (item.attack ?? 0) + (item.defense ?? 0) + (item.armor ?? 0) * 3 + (item.levelRequired ?? 0) / 2;
  return Math.max(0, Math.min(1, valor / 110));
}

function corPocao(nome: string, neon: RGB): RGB {
  if (tem(nome, 'spirit')) return [190, 90, 255];
  if (tem(nome, 'health', 'life', 'heal')) return [255, 60, 110];
  if (tem(nome, 'mana')) return [70, 140, 255];
  return neon;
}

function corGema(nome: string, neon: RGB): RGB {
  if (tem(nome, 'diamond', 'white')) return [225, 240, 255];
  if (tem(nome, 'ruby', 'red')) return [255, 50, 80];
  if (tem(nome, 'sapphire', 'blue')) return [60, 120, 255];
  if (tem(nome, 'emerald', 'green')) return [50, 230, 120];
  if (tem(nome, 'amethyst', 'violet', 'purple')) return [180, 80, 255];
  if (tem(nome, 'topaz', 'yellow', 'gold')) return [255, 205, 60];
  return neon;
}

function desenhar(g: Ctx, cat: Categoria, nome: string, neon: RGB, f: number): (h: Ctx) => void {
  const casco = mistura(neon, 0.45);
  const metal = f > 0.6 ? mistura(METAL, 1.12) : METAL;
  // Cada caso desenha o corpo (que recebe o acabamento) e devolve os brilhos de cima.
  switch (cat) {
    case 'espada':
      linha(g, metal, 9, 23, 25, 7, 4);
      linha(g, ESCURO, 6, 20, 12, 26, 3);
      linha(g, CABO, 4, 28, 9, 23, 3);
      return (h) => { linha(h, neon, 12, 19, 24, 7, 1); luz(h, neon, 9, 22, 2, 2); };
    case 'machado':
      linha(g, CABO, 6, 27, 20, 9, 3);
      poli(g, metal, [[17, 4], [27, 8], [26, 18], [20, 14], [16, 10]]);
      return (h) => { linha(h, neon, 26, 9, 25, 17, 1); };
    case 'martelo':
      linha(g, CABO, 7, 27, 18, 12, 3);
      ret(g, metal, 13, 4, 14, 9, 2);
      return (h) => { luz(h, neon, 15, 7, 10, 2); };
    case 'maca':
      linha(g, CABO, 7, 27, 17, 13, 3);
      for (const [x, y] of [[20, 3], [26, 6], [27, 12], [14, 6]] as const) linha(g, mistura(metal, 0.8), 20, 10, x, y, 2);
      elipse(g, metal, 20, 10, 6, 6);
      return (h) => { elipse(h, neon, 20, 10, 2.5, 2.5); brilho(h, neon, 20, 10, 6, 0.4 + f * 0.4); };
    case 'soco':
      ret(g, ESCURO, 8, 12, 17, 13, 4);
      ret(g, metal, 8, 9, 17, 6, 2);
      return (h) => { for (let x = 10; x < 24; x += 4) luz(h, neon, x, 10, 2, 2); };
    case 'arco':
      g.strokeStyle = `rgb(${mistura(metal, 1.1).join(',')})`; g.lineWidth = 4;
      g.beginPath(); g.arc(6, 16, 14, -1.2, 1.2); g.stroke();
      return (h) => { linha(h, neon, 11, 3, 11, 29, 1); brilho(h, neon, 11, 16, 7, 0.3 + f * 0.4); };
    case 'besta':
      ret(g, CABO, 6, 14, 22, 4, 1);
      g.strokeStyle = `rgb(${metal.join(',')})`; g.lineWidth = 3;
      g.beginPath(); g.arc(23, 16, 10, 2.2, 4.1); g.stroke();
      return (h) => { linha(h, neon, 17, 8, 17, 24, 1); luz(h, neon, 24, 15, 4, 2); };
    case 'lanca':
      linha(g, CABO, 5, 27, 22, 10, 2);
      poli(g, metal, [[20, 8], [28, 4], [24, 12]]);
      return (h) => { luz(h, neon, 23, 7, 2, 2); };
    case 'estrela':
      poli(g, metal, [[16, 3], [19, 13], [29, 16], [19, 19], [16, 29], [13, 19], [3, 16], [13, 13]]);
      return (h) => { elipse(h, neon, 16, 16, 2, 2); brilho(h, neon, 16, 16, 8, 0.3 + f * 0.4); };
    case 'dardo':
      for (const d of [0, 6]) {
        linha(g, ESCURO, 4 + d, 26, 20 + d, 10, 2);
        poli(g, metal, [[18 + d, 8], [25 + d, 5], [22 + d, 12]]);
      }
      return (h) => { for (const d of [0, 6]) luz(h, neon, 4 + d, 25, 2, 2); };
    case 'bala':
      for (const x of [8, 15, 22]) { ret(g, metal, x, 12, 5, 14, 1); elipse(g, mistura(metal, 1.15), x + 2.5, 12, 2.5, 4); }
      return (h) => { for (const x of [8, 15, 22]) luz(h, neon, x, 22, 5, 1); };
    case 'varinha':
      linha(g, ESCURO, 6, 27, 22, 11, 3);
      poli(g, neon, [[22, 5], [27, 10], [22, 15], [17, 10]]);
      return (h) => { brilho(h, neon, 22, 10, 9, 0.45 + f * 0.4); luz(h, [255, 255, 255], 21, 8, 2, 2); };
    case 'cajado':
      linha(g, CABO, 7, 28, 20, 13, 4);
      elipse(g, neon, 22, 10, 6, 6);
      return (h) => { brilho(h, neon, 22, 10, 11, 0.45 + f * 0.4); luz(h, [255, 255, 255], 20, 7, 2, 2); };
    case 'datapad':
      ret(g, ESCURO, 6, 4, 20, 25, 3);
      ret(g, casco, 9, 7, 14, 17, 1);
      return (h) => { for (let y = 9; y < 22; y += 3) luz(h, neon, 10, y, 6 + ((y * 7) % 7), 1); luz(h, neon, 15, 26, 2, 1); };
    case 'escudo':
      poli(g, metal, [[6, 5], [26, 5], [26, 15], [16, 28], [6, 15]]);
      poli(g, casco, [[10, 8], [22, 8], [22, 15], [16, 23], [10, 15]]);
      return (h) => { linha(h, neon, 16, 9, 16, 21, 1); linha(h, neon, 11, 13, 21, 13, 1); brilho(h, neon, 16, 14, 8, 0.2 + f * 0.4); };
    case 'armadura':
      poli(g, casco, [[5, 8], [11, 4], [21, 4], [27, 8], [24, 14], [23, 28], [9, 28], [8, 14]]);
      ret(g, metal, 4, 6, 7, 6, 2); ret(g, metal, 21, 6, 7, 6, 2);
      return (h) => { linha(h, neon, 16, 7, 16, 25, 1); luz(h, neon, 12, 18, 8, 1); };
    case 'capacete':
      elipse(g, metal, 16, 16, 11, 11);
      ret(g, metal, 5, 16, 22, 10, 2);
      ret(g, ESCURO, 8, 14, 16, 5, 2);
      return (h) => { luz(h, neon, 9, 15, 14, 2); brilho(h, neon, 16, 16, 9, 0.25 + f * 0.4); };
    case 'calca':
      ret(g, casco, 8, 4, 16, 7, 1);
      ret(g, casco, 8, 9, 7, 20, 2); ret(g, casco, 17, 9, 7, 20, 2);
      ret(g, metal, 8, 14, 7, 4, 1); ret(g, metal, 17, 14, 7, 4, 1);
      return (h) => { luz(h, neon, 8, 6, 16, 1); luz(h, neon, 10, 22, 2, 4); luz(h, neon, 20, 22, 2, 4); };
    case 'bota':
      ret(g, casco, 9, 5, 9, 18, 2);
      ret(g, casco, 9, 18, 17, 7, 3);
      ret(g, ESCURO, 8, 24, 19, 4, 1);
      return (h) => { luz(h, neon, 8, 27, 19, 1); luz(h, neon, 11, 8, 5, 1); brilho(h, neon, 17, 27, 7, 0.2 + f * 0.4); };
    case 'anel':
      g.strokeStyle = `rgb(${metal.join(',')})`; g.lineWidth = 3;
      g.beginPath(); g.ellipse(16, 19, 8, 7, 0, 0, Math.PI * 2); g.stroke();
      elipse(g, neon, 16, 11, 4, 3.5);
      return (h) => { brilho(h, neon, 16, 11, 8, 0.4 + f * 0.4); luz(h, [255, 255, 255], 15, 10, 1, 1); };
    case 'colar':
      g.strokeStyle = `rgb(${metal.join(',')})`; g.lineWidth = 2;
      g.beginPath(); g.arc(16, 9, 10, 0.15, Math.PI - 0.15); g.stroke();
      poli(g, casco, [[16, 16], [22, 22], [16, 29], [10, 22]]);
      return (h) => { elipse(h, neon, 16, 22, 2.5, 2.5); brilho(h, neon, 16, 22, 8, 0.35 + f * 0.4); };
    case 'mochila':
      ret(g, casco, 7, 7, 18, 21, 4);
      ret(g, mistura(casco, 1.3), 9, 5, 14, 9, 3);
      ret(g, ESCURO, 10, 18, 12, 7, 2);
      return (h) => { luz(h, neon, 10, 15, 12, 1); luz(h, neon, 15, 20, 2, 2); };
    case 'pocao': {
      const liquido = corPocao(nome, neon);
      ret(g, [190, 205, 230], 13, 4, 6, 7, 1);
      elipse(g, [170, 186, 214], 16, 19, 9, 9);
      elipse(g, liquido, 16, 21, 7, 6);
      ret(g, CABO, 12, 3, 8, 3, 1);
      return (h) => { brilho(h, liquido, 16, 20, 10, 0.4); luz(h, [255, 255, 255], 12, 16, 2, 3); };
    }
    case 'chip': {
      const cor: RGB = tem(nome, 'heal', 'cure') ? [57, 255, 136] : tem(nome, 'field', 'wall', 'bomb', 'magic', 'paralyse', 'convince', 'chameleon', 'animate', 'disintegrate', 'destroy') ? [0, 229, 255] : neon;
      ret(g, ESCURO, 6, 5, 20, 22, 2);
      ret(g, mistura(cor, 0.35), 9, 8, 14, 16, 1);
      for (let y = 8; y < 26; y += 4) { luz(g, METAL, 3, y, 3, 2); luz(g, METAL, 26, y, 3, 2); }
      return (h) => { ret(h, cor, 13, 12, 6, 8, 1); linha(h, cor, 10, 10, 13, 13, 1); linha(h, cor, 22, 22, 19, 19, 1); brilho(h, cor, 16, 16, 9, 0.35); };
    }
    case 'comida':
      ret(g, metal, 8, 8, 16, 19, 2);
      elipse(g, mistura(metal, 1.15), 16, 8, 8, 3);
      ret(g, casco, 8, 13, 16, 9, 0);
      return (h) => { luz(h, neon, 10, 16, 12, 2); };
    case 'gema': {
      const cor = corGema(nome, neon);
      poli(g, cor, [[10, 7], [22, 7], [27, 13], [16, 28], [5, 13]]);
      poli(g, mistura(cor, 1.3), [[10, 7], [22, 7], [19, 13], [13, 13]]);
      return (h) => { brilho(h, cor, 16, 15, 12, 0.35); luz(h, [255, 255, 255], 12, 9, 2, 2); };
    }
    case 'perola':
      elipse(g, [226, 226, 240], 16, 16, 9, 9);
      return (h) => { luz(h, [255, 255, 255], 12, 11, 3, 3); brilho(h, neon, 16, 16, 12, 0.25); };
    case 'moeda': {
      const cor: RGB = tem(nome, 'crystal') ? [255, 60, 210] : tem(nome, 'platinum') ? [170, 210, 255] : [0, 229, 255];
      elipse(g, [16, 30, 44], 16, 16, 11, 11);
      if (!/\bcoins?\b/.test(nome)) {
        // Ficha ou medalha: não é Edinho, leva estrela no lugar do E.
        return (h) => {
          h.strokeStyle = `rgb(${neon.join(',')})`; h.lineWidth = 2;
          h.beginPath(); h.arc(16, 16, 9, 0, Math.PI * 2); h.stroke();
          poli(h, neon, [[16, 10], [18, 15], [22, 16], [18, 17], [16, 22], [14, 17], [10, 16], [14, 15]]);
        };
      }
      return (h) => {
        h.strokeStyle = `rgb(${cor.join(',')})`; h.lineWidth = 2;
        h.beginPath(); h.arc(16, 16, 9, 0, Math.PI * 2); h.stroke();
        luz(h, cor, 13, 11, 6, 2); luz(h, cor, 13, 15, 5, 2); luz(h, cor, 13, 19, 6, 2); luz(h, cor, 13, 11, 2, 10);
        brilho(h, cor, 16, 16, 13, 0.3);
      };
    }
    case 'capsula':
      ret(g, [180, 196, 222], 5, 11, 22, 10, 5);
      ret(g, neon, 8, 13, 12, 6, 3);
      ret(g, METAL, 21, 10, 6, 12, 2);
      return (h) => { brilho(h, neon, 13, 16, 9, 0.35); luz(h, [255, 255, 255], 8, 13, 3, 1); };
    case 'engrenagem':
      for (let i = 0; i < 8; i += 1) {
        const a = (i * Math.PI) / 4;
        ret(g, metal, 16 + Math.cos(a) * 10 - 2.5, 16 + Math.sin(a) * 10 - 2.5, 5, 5, 1);
      }
      elipse(g, metal, 16, 16, 9, 9);
      elipse(g, ESCURO, 16, 16, 4, 4);
      return (h) => { elipse(h, neon, 16, 16, 2, 2); brilho(h, neon, 16, 16, 7, 0.35); };
    case 'placa':
      ret(g, [24, 70, 56], 4, 7, 24, 18, 2);
      ret(g, ESCURO, 11, 11, 9, 9, 1);
      return (h) => { linha(h, neon, 6, 10, 11, 13, 1); linha(h, neon, 20, 18, 26, 22, 1); linha(h, neon, 20, 12, 26, 9, 1); luz(h, neon, 14, 14, 3, 3); };
    case 'ferramenta':
      linha(g, metal, 8, 25, 21, 12, 4);
      elipse(g, metal, 23, 9, 6, 6);
      g.globalCompositeOperation = 'destination-out';
      ret(g, '#000', 22, 3, 4, 7, 0);
      g.globalCompositeOperation = 'source-over';
      return (h) => { luz(h, neon, 9, 23, 2, 2); };
    case 'nucleo':
      ret(g, ESCURO, 7, 22, 18, 6, 2);
      elipse(g, neon, 16, 14, 8, 8);
      return (h) => { brilho(h, neon, 16, 14, 14, 0.5 + f * 0.3); luz(h, [255, 255, 255], 13, 10, 3, 2); };
    case 'pergaminho':
      ret(g, [196, 206, 226], 7, 5, 18, 23, 1);
      poli(g, [150, 160, 186], [[19, 5], [25, 5], [25, 11]]);
      return (h) => { for (let y = 10; y < 25; y += 3) luz(h, neon, 10, y, 4 + ((y * 5) % 9), 1); };
    case 'luz':
      ret(g, ESCURO, 13, 18, 6, 11, 2);
      ret(g, neon, 12, 4, 8, 15, 3);
      return (h) => { brilho(h, neon, 16, 11, 14, 0.55); luz(h, [255, 255, 255], 14, 6, 2, 8); };
    case 'fragmento':
    default:
      poli(g, casco, [[16, 3], [24, 12], [20, 28], [10, 24], [8, 11]]);
      poli(g, neon, [[16, 3], [20, 12], [16, 22], [12, 12]]);
      return (h) => { brilho(h, neon, 16, 14, 10, 0.35); };
  }
}

const cache = new Map<number, string>();

/** Ícone 32x32 (data URL) do item, desenhado por código. */
export function iconeNeon(item: ItemDesenho): string | null {
  const pronto = cache.get(item.id);
  if (pronto) return pronto;
  if (typeof document === 'undefined') return null;
  const nome = (item.nomeOriginal ?? item.name).toLowerCase();
  const neon = hslRgb(matiz(item, nome), 95, 58);
  const f = forca(item);
  const c = document.createElement('canvas');
  c.width = TAM; c.height = TAM;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  const brilhos = desenhar(g, categoria(item, nome), nome, neon, f);
  acabamento(g, TAM);
  brilhos(g);
  const url = c.toDataURL('image/png');
  cache.set(item.id, url);
  return url;
}
