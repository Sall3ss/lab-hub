// lib/arquivos.js — BASE compartilhada: onde mora o arquivo que o cliente envia.
//
// Convenção da casa (decidida em 08/08/2026, quando o R2 foi liberado):
//
//   depósito R2:  painel-<cliente>-arquivos
//   binding:      ARQUIVOS            (do mesmo jeito que o banco é DB)
//   chave:        <dono>/<id>-<nome>  ex.: 12/87-exame-audiometria.pdf
//
// A chave começa pelo dono (o paciente, o cliente, o que for a entidade principal do
// painel) porque isso deixa "apagar tudo de um dono" ser um prefixo, e não uma busca.
//
// Quem manda no ciclo de vida é o BANCO, não o depósito: o D1 guarda a chave e os
// metadados, o R2 guarda os bytes. Apagou a linha, apaga o objeto - senão o depósito vira
// um cemitério de arquivo órfão que ninguém sabe de quem é.
//
// Por que não guardar o arquivo no próprio D1: dá para fazer, e este projeto fez enquanto
// o R2 não estava liberado, mas o limite é de 1 MB por linha e o banco cresce carregando
// byte de imagem em toda consulta. Não é lugar de arquivo.
//
// Autoria: Claude (Opus 5), 08/08/2026.

/**
 * Nome de arquivo seguro para virar chave: sem acento, sem espaço, sem barra.
 * O nome original continua no banco - este aqui é só o que vai no caminho do objeto.
 */
export function nomeSeguro(nome, max = 80) {
  return String(nome || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // tira acento
    .replace(/[^\w.\- ]+/g, '')                         // só letra, número, ponto, hífen
    .trim().replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max) || 'arquivo';
}

/** Monta a chave no padrão da casa. */
export const chaveDe = (dono, id, nome) => `${dono}/${id}-${nomeSeguro(nome)}`;

export function arquivos(env) {
  const dep = env.ARQUIVOS;
  if (!dep) {
    // Acontece quando o binding não foi ligado no projeto Pages, ou quando o deploy é
    // anterior à ligação: binding novo só passa a existir no deploy SEGUINTE.
    throw new Error('Binding R2 "ARQUIVOS" não configurado neste projeto.');
  }
  return {
    /**
     * Grava e devolve o objeto do R2 (que já traz o `size` real gravado).
     * `corpo` pode ser stream, ArrayBuffer ou Blob.
     */
    async guardar(chave, corpo, { tipo, nome } = {}) {
      return await dep.put(chave, corpo, {
        httpMetadata: {
          contentType: tipo || 'application/octet-stream',
          // `attachment` não: documento clínico costuma ser aberto para conferir, não
          // baixado. O nome original vai junto para o download ficar com nome de gente.
          contentDisposition: nome ? `inline; filename="${nomeSeguro(nome)}"` : undefined,
        },
      });
    },

    /** Objeto do R2 (com .body streamável) ou null. */
    async ler(chave) {
      return chave ? await dep.get(chave) : null;
    },

    /** Apagar é idempotente: apagar o que não existe não é erro. */
    async apagar(chave) {
      if (chave) await dep.delete(chave);
    },

    /** Apagar tudo de um dono. Usa o prefixo da chave; por isso ele vem primeiro. */
    async apagarDoDono(dono) {
      let cursor;
      let apagados = 0;
      do {
        const lista = await dep.list({ prefix: `${dono}/`, cursor });
        if (lista.objects.length) {
          await dep.delete(lista.objects.map((o) => o.key));
          apagados += lista.objects.length;
        }
        cursor = lista.truncated ? lista.cursor : undefined;
      } while (cursor);
      return apagados;
    },

    bruto: dep,
  };
}

/** O projeto tem depósito de arquivo ligado? Útil para a tela avisar em vez de quebrar. */
export const temDeposito = (env) => !!env.ARQUIVOS;
