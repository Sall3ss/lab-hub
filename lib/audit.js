// lib/audit.js — trilha de auditoria. Grava quem fez o que, quando, antes/depois.
// Mesma ideia do _audit.js do painel-f1. Escreve na tabela "auditoria" (migration 0001).

import { db } from './db.js';

export async function auditar(env, { quem, acao, entidade, entidade_id = null, antes = null, depois = null, ip = null }) {
  try {
    await db(env).run(
      `INSERT INTO auditoria (quando, quem, acao, entidade, entidade_id, antes, depois, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      new Date().toISOString(), quem || 'desconhecido', acao, entidade, entidade_id,
      antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null, ip
    );
  } catch (e) {
    // Auditoria nunca deve derrubar a requisicao principal.
    console.error('falha ao auditar:', e.message);
  }
}
