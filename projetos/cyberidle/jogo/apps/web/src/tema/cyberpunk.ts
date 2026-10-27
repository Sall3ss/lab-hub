import { hunts, items, monsters, monstersById, vocations } from '@tibia-idle/data';
import { HEALTH_POTION_TIERS, MANA_POTION_TIERS, SPIRIT_POTION_TIERS } from '@tibia-idle/sim';

/**
 * Tema cyberpunk do Cyberidle (só nomes; mecânica igual). Lab Hub, Claude (Opus 5.5).
 *
 * Os nomes de monstros, caçadas, vocações e das moedas são trocados UMA vez, no começo,
 * direto nos dados - assim tela, log, mapa e bestiário mudam juntos. O nome original fica
 * em `nomeOriginal` para o que depende dele (tema visual da caçada, por exemplo).
 * O ouro chama "Edinho" (pedido do dono). Para ajustar um nome, edite as tabelas abaixo.
 */

export const MOEDA = 'Edinho';

/** Vocação por id (1-4 base, 5-8 promovidas, 9-10 monk). */
const VOCACOES: Record<number, string> = {
  1: 'Netrunner',
  2: 'Biohacker',
  3: 'Gunslinger',
  4: 'Street Samurai',
  5: 'Master Netrunner',
  6: 'Elder Biohacker',
  7: 'Elite Gunslinger',
  8: 'Chrome Samurai',
  9: 'Cyber Monk',
  10: 'Ascended Cyber Monk',
};

/** Sigla curta (abas do Helper). */
export const SIGLA_VOCACAO: Record<number, string> = {
  1: 'NR', 2: 'BH', 3: 'GS', 4: 'SS', 5: 'MN', 6: 'EB', 7: 'EG', 8: 'CS', 9: 'CM', 10: 'AM',
};

/** Moedas (itens). */
const MOEDAS: Record<number, string> = {
  3031: 'edinho',
  3035: 'edinho de platina',
  3043: 'edinho de cristal',
};

/** Cidade/local da caçada -> distrito da megacidade. */
export const DISTRITOS: Record<string, string> = {
  Venore: 'Neon Underbelly', Darashia: 'Dust Sprawl', Edron: 'Core Mainframe', 'Port Hope': 'Toxic Canopy',
  Yalahar: 'Old Megacity', Kazordoon: 'Auto-Mines', Oramond: 'Factory District', Ankrahmun: 'Sand Arcology',
  Roshamuul: 'Quarantine Zone', Issavi: 'Sun Plaza', Farmine: 'Drill Station', Warzone: 'War Zone',
  Carlin: 'Green Sector', 'Liberty Bay': 'Cyber Harbor', Svargrond: 'Cryo Block', Rascacoon: 'Scrap Docks',
  Tiquanda: 'Toxic Canopy', Darama: 'Dust Sprawl', "Ab'Dendriel": 'Hydro Gardens', Spike: 'Spike Shaft',
  'Gray Island': 'Hive Island', Krailos: 'Ruined Grid', Marapur: 'Tide District', "Kha'labal": 'Dust Sprawl',
  Amazon: 'Amazon Sector', Mistrock: 'Mist Foundry', Meriana: 'Floating Port', Northport: 'North Port',
  Elves: 'Hydro Gardens', Banuta: 'Toxic Canopy', "Kha'zeel": 'Sky Ridge', Ramoa: 'Wild Zone',
  Stampor: 'Wild Zone', Fenrock: 'Lava Works', Drefia: 'Dead Server Farm', Nightmare: 'Nightmare Net',
  Catacombs: 'Server Catacombs', Candia: 'Sugar Lab', Lower: 'Lower Stacks', Fire: 'Furnace Ring',
  Summer: 'Heat Block', Asura: 'Asura Shrine', Netherworld: 'Deep Net', Ingol: 'Ingol Bunker',
  Iksupan: 'Iksupan Ruins', Podzilla: 'Pod Farm', Thais: 'Corporate Grid',
};

/** Regiões do mapa de caçadas. */
export const REGIOES: Record<string, string> = {
  Mainland: 'Megacidade', Darama: 'Deserto Radioativo', Tiquanda: 'Selva Tóxica', Ilhas: 'Ilhas Offshore', Endgame: 'Zona Final',
};

/**
 * Palavras (inglês do jogo original -> cyberpunk). Troca palavra inteira, mantendo a ordem.
 * Plural regular ("Rotworms") cai na palavra singular.
 */
const PALAVRAS: Record<string, string> = {
  // criaturas
  Rotworm: 'Rustworm', Worm: 'Wireworm', Larva: 'Nanolarva', Terramite: 'Drillmite', Scarab: 'Scarab Drone',
  Dragon: 'Mecha-Dragon', Hatchling: 'Prototype', Wyrm: 'Plasma Wyrm', Wyvern: 'Jet Wyvern', Hydra: 'Hydra Rig',
  Demon: 'Daemon', Skeleton: 'Chrome Skeleton', Ghost: 'Glitch', Ghoul: 'Junkie Ghoul', Mummy: 'Cryo Mummy',
  Vampire: 'Bloodhacker', Lich: 'Root Lich', Necromancer: 'Necrocoder', Banshee: 'Static Banshee',
  Spectre: 'Hologram', Soul: 'Ghost', Wraith: 'Packet Wraith', Reaper: 'Reaper Unit',
  Orc: 'Ganger', Minotaur: 'Bull Cyborg', Cyclops: 'Cyclops Mech', Troll: 'Sewer Troll', Giant: 'Titan Frame',
  Elf: 'Neon Elf', Amazon: 'Amazon Merc', Valkyrie: 'Valkyrie Merc', Barbarian: 'Wasteland', Bandit: 'Street Thug',
  Nomad: 'Drifter', Pirate: 'Data Pirate', Pirat: 'Data Pirate', Smuggler: 'Contrabander', Hero: 'Hero Merc',
  Gladiator: 'Arena Fighter', Knight: 'Corp Enforcer', Paladin: 'Corp Ranger', Cult: 'Syndicate', Cultist: 'Syndicate', Witch: 'Hex Coder',
  Spider: 'Spiderbot', Tarantula: 'Tarantula Bot', Scorpion: 'Scorpion Bot', Centipede: 'Centipede Drone',
  Snake: 'Cable Snake', Cobra: 'Cobra Drone', Crab: 'Crab Bot', Squid: 'Squid Drone', Turtle: 'Tank Turtle',
  Tortoise: 'Tank Tortoise', Toad: 'Toxic Toad', Bat: 'Bat Drone', Rat: 'Sewer Rat', Wolf: 'Cyberwolf',
  Lion: 'Chrome Lion', Tiger: 'Chrome Tiger', Boar: 'Iron Boar', Mole: 'Digger Bot', Harpy: 'Harpy Drone',
  Werewolf: 'Wolf Splice', Werebear: 'Bear Splice', Wereboar: 'Boar Splice', Werebadger: 'Badger Splice',
  Werefox: 'Fox Splice', Weretiger: 'Tiger Splice', Werelion: 'Lion Splice', Werelioness: 'Lioness Splice',
  Werepanther: 'Panther Splice', Werehyaena: 'Hyena Splice', Werecrocodile: 'Croc Splice',
  Golem: 'Mech', Gargoyle: 'Gargoyle Sentry', Elemental: 'Energy Core', Djinn: 'AI Djinn', Efreet: 'Fire AI',
  Medusa: 'Medusa Unit', Sphinx: 'Sphinx AI', Naga: 'Naga Splice', Quara: 'Deep Diver', Serpent: 'Sea Drone',
  Lizard: 'Lizard Splice', Draken: 'Draken Splice', Asura: 'Asura Unit', Behemoth: 'Behemoth Mech',
  Hellhound: 'Hellhound Bot', Juggernaut: 'Juggernaut Mech', Fury: 'Fury Unit', Nightmare: 'Nightmare.exe',
  Devourer: 'Devourer Bot', Spawn: 'Spawn', Book: 'Data Tome', Fungus: 'Nanofungus', Blob: 'Gel Blob',
  Bug: 'Bug', Beetle: 'Beetle Drone', Waspoid: 'Wasp Drone', Swarmer: 'Swarm Drone',
  Mutated: 'Mutated', Human: 'Splicer', Crypt: 'Datacrypt', Squire: 'Corp Cadet', Torturer: 'Interrogator',
  Plaguesmith: 'Virus Smith', Souleater: 'Data Eater', Lava: 'Plasma', Guardian: 'Guardian Unit',
  Warden: 'Warden Unit', Widow: 'Widow Bot', Crawler: 'Crawler Drone', Brimstone: 'Sulfur', Corpus: 'Corpus', Horror: 'Horror.exe', Insectoid: 'Insect Drone', Glooth: 'Glooth',
  // lugares
  Cave: 'Sewers', Caves: 'Sewers', Lair: 'Nest', Tomb: 'Server Vault', Temple: 'Data Temple', Camp: 'Squat',
  Tower: 'Arcology', Laboratory: 'Lab', Ruins: 'Ruins', Island: 'Island', Mountain: 'Tower Block',
  Tunnels: 'Tunnels', Pyramid: 'Pyramid Server', Mines: 'Auto-Mines', Market: 'Market', Quarter: 'Block',
  Cemetery: 'Junkyard', Catacombs: 'Server Catacombs', Swamp: 'Toxic Swamp', Forest: 'Hydro Forest',
  Jungle: 'Toxic Canopy', Desert: 'Dust Sprawl', Dojo: 'Dojo', Hive: 'Hive Node', Surface: 'Surface',
  Underground: 'Undercity', Sewer: 'Sewers', Fortress: 'Bunker', Castle: 'Corp Tower', Port: 'Port',
};

/**
 * Monstro cujo nome não tem nenhuma palavra no dicionário (nomes próprios como "Kongra")
 * ganha um prefixo pela classe do bestiário: "Kongra" -> "Cyber-Kongra".
 */
const PREFIXO_CLASSE: Record<string, string> = {
  Vermin: 'Bio-', Undead: 'Necro-', Demon: 'Daemon ', Construct: 'Mech ', Magical: 'Hex ',
  Human: 'Ganger ', Humanoid: 'Mutant ', Elemental: 'Plasma ', Plant: 'Toxi-', Reptile: 'Scale ',
  Mammal: 'Cyber-', 'Extra Dimensional': 'Void ', Aquatic: 'Hydro ', Dragon: 'Mecha-',
  Lycanthrope: 'Splice ', Giant: 'Titan ', Inkborn: 'Glitch ', Bird: 'Jet ', Slime: 'Gel ', Amphibic: 'Toxi-',
};

/** Itens (minúsculo, como no jogo). Troca palavra inteira; o resto do nome fica. */
const ITENS: Record<string, string> = {
  sword: 'monoblade', blade: 'monoblade', sabre: 'plasma sabre', katana: 'mono-katana', rapier: 'laser rapier',
  axe: 'power axe', hatchet: 'power hatchet', club: 'shock baton', mace: 'shock mace', hammer: 'pneumatic hammer',
  morning: 'morning', star: 'star', staff: 'neuro staff', bow: 'rail bow', crossbow: 'rail crossbow',
  arrow: 'smart dart', bolt: 'rail slug', spear: 'ion spear', dagger: 'vibro dagger', knife: 'vibro knife',
  wand: 'neuro wand', rod: 'bio rod', shield: 'energy shield', armor: 'armor rig', robe: 'smart robe',
  helmet: 'visor helmet', hat: 'smart cap', legs: 'leg servos', boots: 'jet boots', sandals: 'grip soles',
  ring: 'ring chip', amulet: 'amulet chip', necklace: 'neural link', potion: 'stim', rune: 'code chip',
  backpack: 'cyberpack', bag: 'data bag', torch: 'glowstick', rope: 'grapple cable', shovel: 'dig drill',
  pick: 'laser pick', fish: 'synth fish', meat: 'vat meat', ham: 'vat ham', bread: 'nutri bar', apple: 'synth apple',
  mushroom: 'lab mushroom', leather: 'synth-leather', steel: 'titanium', iron: 'alloy', copper: 'circuit',
  crystal: 'quantum', magic: 'neon', dragon: 'mecha-dragon', demon: 'daemon', knight: 'enforcer',
  plate: 'plate', scale: 'kevlar', chain: 'mesh', studded: 'riveted', golden: 'gold-plated', royal: 'corporate',
  ancient: 'legacy', elven: 'neon-elf', dwarven: 'mech', orcish: 'ganger', skull: 'chrome skull', bone: 'chrome bone',
  spellbook: 'datapad', book: 'data tome', scroll: 'data scroll', gem: 'data gem', pearl: 'data pearl',
};

function trocarItem(nome: string): string {
  return nome.replace(/[A-Za-z][A-Za-z'-]*/g, (palavra) => {
    const minus = palavra.toLowerCase();
    let novo = ITENS[minus];
    if (!novo && minus.endsWith('s') && ITENS[minus.slice(0, -1)]) novo = `${ITENS[minus.slice(0, -1)]}s`;
    if (!novo) return palavra;
    return palavra[0] === palavra[0]!.toUpperCase() ? novo[0]!.toUpperCase() + novo.slice(1) : novo;
  });
}

const RE_PALAVRA = /[A-Za-z][A-Za-z'-]*/g;

function trocarPalavra(palavra: string, lugares: boolean): string {
  if (lugares && DISTRITOS[palavra]) return DISTRITOS[palavra]!;
  if (PALAVRAS[palavra]) return PALAVRAS[palavra]!;
  if (palavra.endsWith('s') && PALAVRAS[palavra.slice(0, -1)]) return `${PALAVRAS[palavra.slice(0, -1)]}s`;
  return palavra;
}

/** Troca palavras conhecidas num nome do jogo original. */
export function cyberNome(nome: string, lugares = true): string {
  let saida = nome;
  // Nomes de lugar com espaço primeiro (ex.: "Port Hope").
  if (lugares) {
    for (const [orig, novo] of Object.entries(DISTRITOS)) {
      if (orig.includes(' ') && saida.includes(orig)) saida = saida.split(orig).join(novo);
    }
  }
  return saida.replace(RE_PALAVRA, (palavra) => trocarPalavra(palavra, lugares));
}

const porNomeOriginal = new Map<string, string>();

/** Nome cyberpunk de um monstro, a partir do id ou do nome original. */
export function nomeMonstro(idOuNome: string): string {
  return monstersById.get(idOuNome)?.name ?? porNomeOriginal.get(idOuNome.toLowerCase()) ?? cyberNome(idOuNome, false);
}

export function distrito(local: string | undefined | null): string {
  if (!local) return 'Outros';
  return DISTRITOS[local] ?? cyberNome(local);
}

export function regiao(nome: string): string {
  return REGIOES[nome] ?? nome;
}

let aplicado = false;

export function aplicarTema(): void {
  if (aplicado) return;
  aplicado = true;
  const marcar = (obj: { name: string; nomeOriginal?: string }, novo: string) => {
    obj.nomeOriginal ??= obj.name;
    obj.name = novo;
  };
  for (const v of vocations as Array<{ id: number; name: string }>) {
    if (VOCACOES[v.id]) marcar(v, VOCACOES[v.id]!);
  }
  for (const m of monsters as Array<{ name: string; bestiary?: { class?: string } | null }>) {
    const original = m.name;
    let novo = cyberNome(original, false);
    if (novo === original) novo = `${PREFIXO_CLASSE[m.bestiary?.class ?? ''] ?? 'Cyber-'}${original}`;
    marcar(m, novo);
    porNomeOriginal.set(original.toLowerCase(), m.name);
  }
  for (const h of hunts as Array<{ name: string }>) marcar(h, cyberNome(h.name));
  for (const i of items as Array<{ id: number; name: string; plural?: string | null }>) {
    if (MOEDAS[i.id]) {
      marcar(i, MOEDAS[i.id]!);
      i.plural = `${MOEDAS[i.id]!.replace('edinho', 'edinhos')}`;
      continue;
    }
    const novo = trocarItem(i.name);
    if (novo !== i.name) {
      marcar(i, novo);
      if (i.plural) i.plural = trocarItem(i.plural);
    }
  }
  // Tabelas de poção do Helper têm o nome escrito à parte (só exibição).
  for (const tier of [...HEALTH_POTION_TIERS, ...MANA_POTION_TIERS, ...SPIRIT_POTION_TIERS] as Array<{ name: string }>) {
    tier.name = trocarItem(tier.name);
  }
}

// ---------------------------------------------------------------- textos da interface
// O ouro aparece em dezenas de textos ("gold", "gp", "ouro") e os locais das caçadas em
// várias telas. Em vez de editar cada componente, um observador troca só o TEXTO exibido
// (nunca classes, ids ou valores de campo). Só reescreve quando muda, sem laço.

const RE_MOEDA = /\b(gold|Gold|GOLD|gp|ouro|Ouro)\b/g;
// Lugares que também são palavras de monstro (Amazon, Nightmare, Asura, Catacombs...) ficam
// fora da troca solta de texto: senão "Amazon Merc" (monstro) virava "Amazon Sector Merc".
const AMBIGUOS = new Set(['Amazon', 'Nightmare', 'Asura', 'Catacombs', 'Fire', 'Elves', 'Lower', 'Summer', 'Spike']);
const LUGARES = Object.keys(DISTRITOS).filter((l) => !AMBIGUOS.has(l) && !PALAVRAS[l]).sort((a, b) => b.length - a.length);
const RE_LUGAR = new RegExp(`(^|[^A-Za-z'])(${LUGARES.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'g');

// Vocações escritas soltas em textos fixos (ex.: "Arma inicial do Knight").
const VOC_TEXTO: Record<string, string> = {
  'Elite Knight': 'Chrome Samurai', 'Royal Paladin': 'Elite Gunslinger', 'Master Sorcerer': 'Master Netrunner',
  'Elder Druid': 'Elder Biohacker', 'Exalted Monk': 'Ascended Cyber Monk',
  Knight: 'Street Samurai', Paladin: 'Gunslinger', Sorcerer: 'Netrunner', Druid: 'Biohacker', Monk: 'Cyber Monk',
};
const RE_VOC = /\b(Elite Knight|Royal Paladin|Master Sorcerer|Elder Druid|Exalted Monk|Knight|Paladin|Sorcerer|Druid|Monk)\b(?! ?(?:Samurai|Gunslinger|Netrunner|Biohacker))/g;

function trocarTexto(texto: string): string {
  const exato = texto.trim();
  if (REGIOES[exato]) return texto.replace(exato, REGIOES[exato]!);
  return texto
    .replace(RE_VOC, (v, _g, pos: number, todo: string) => (/Cyber $/.test(todo.slice(Math.max(0, pos - 6), pos)) ? v : VOC_TEXTO[v]!))
    .replace(RE_MOEDA, (m) => (m === 'GOLD' ? MOEDA.toUpperCase() : MOEDA))
    .replace(/(\d)g\b/g, `$1 ${MOEDA}`)
    .replace(/(\d) ?TC\b/g, '$1 CC')
    .replace(RE_LUGAR, (m, antes: string, lugar: string, pos: number, todo: string) => {
      const novo = DISTRITOS[lugar]!;
      // Já traduzido (o nome novo começa com o antigo, ex.: "Amazon Sector"): deixa.
      return todo.startsWith(novo, pos + antes.length) ? m : `${antes}${novo}`;
    })
}

// Texto que nós mesmos escrevemos: não traduzir de novo (alguns nomes novos contêm o
// antigo, ex.: "Amazon" -> "Amazon Squat"; sem isto a troca reagia a si mesma sem parar).
const escritos = new WeakMap<Node, string>();
const attrsEscritos = new WeakMap<Element, Record<string, string>>();

function trocarNo(no: Node): void {
  if (no.nodeType === Node.TEXT_NODE) {
    const pai = no.parentElement;
    if (!pai || pai.closest('input, textarea, script, style, [data-sem-tema]')) return;
    const antes = no.nodeValue ?? '';
    if (escritos.get(no) === antes) return;
    let depois = trocarTexto(antes);
    // React separa "350" e "g · 150 XP" em dois textos: olha o número do texto anterior.
    const anterior = no.previousSibling?.textContent ?? '';
    if (/\d$/.test(anterior)) {
      depois = depois.replace(/^g\b/, ` ${MOEDA}`).replace(/^ ?TC\b/, ' CC');
    }
    escritos.set(no, depois);
    if (depois !== antes) no.nodeValue = depois;
    return;
  }
  if (no.nodeType !== Node.ELEMENT_NODE) return;
  const el = no as Element;
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    const feitos = attrsEscritos.get(el) ?? {};
    if (feitos[attr] === v) continue;
    const n = trocarTexto(v);
    feitos[attr] = n;
    attrsEscritos.set(el, feitos);
    if (n !== v) el.setAttribute(attr, n);
  }
  for (const filho of Array.from(no.childNodes)) trocarNo(filho);
}

export function observarTextos(raiz: HTMLElement): void {
  trocarNo(raiz);
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === 'characterData') trocarNo(m.target);
      else if (m.type === 'attributes') trocarNo(m.target);
      else m.addedNodes.forEach((n) => trocarNo(n));
    }
  }).observe(raiz, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
  // Diálogos de confirmação também.
  const confirmar = window.confirm.bind(window);
  window.confirm = (msg?: string) => confirmar(msg ? trocarTexto(msg) : msg);
}
