// projetos/registro.js - GERADO por scripts/novo-projeto.mjs. Nao edite a mao.
// Liga o slug de cada projeto do hub ao modulo de rotas dele (projetos/<slug>/api.js).

import * as p_cyberidle from './cyberidle/api.js';
import * as p_jean from './jean/api.js';
import * as p_cortex from './cortex/api.js';

export const PROJETOS = {
  'cyberidle': p_cyberidle,
  'jean': p_jean,
  'cortex': p_cortex,
};
