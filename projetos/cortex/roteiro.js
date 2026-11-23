// projetos/cortex/roteiro.js - etapa 3 do Cortex: a IA le a transcricao e propoe os cortes.
//
// GRATIS na fase beta (pedido do dono, 14/11/2026): usa o Gemini no plano gratuito, com a
// mesma chave da Jean (GEMINI_API_KEY, secret do Pages). Trocar para o Claude depois e
// trocar so a funcao `perguntar` (o resto - trechos, validacao, gravacao - fica igual).
//
// Como anda (um PASSO por chamada do agente do PC, para cada chamada caber no tempo):
//   passos 0..n-1  um trecho de ~45 min da transcricao -> cortes CURTOS (45-90 s) + resumo
//                  dos assuntos do trecho com os tempos
//   passo n        so se o video tiver 35 min ou mais: le os resumos de todos os trechos e
//                  escolhe os cortes LONGOS (30-40 min)
// Cada passo grava uma linha em cortex_roteiro_partes; se cair no meio, recomeca de onde
// parou. Os cortes vao aparecendo na Triagem enquanto o roteiro anda.
//
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { db } from '../../lib/db.js';
import { pedirFotos } from './cena.js';

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TRECHO_S = 45 * 60;          // tamanho alvo do trecho lido por chamada
const MIN_LONGOS_S = 35 * 60;      // video menor que isso nao ganha corte longo
const PRAZO_GEMINI_MS = 150000;

// 19/11/2026: padrão de títulos, descrições e tags do canal, escrito pelo dono (resumido aqui sem
// perder regra). 21/11/2026: trocado pelo "novo padrão editorial" do dono (contexto da live
// inteira, melhor gancho, nada genérico, 3 ângulos, verificação antes de entregar). Vale para o
// roteiro (cortes novos) e para "Refazer textos" de um corte. NÃO muda a escolha dos cortes.
const PADRAO = `PADRÃO EDITORIAL DO CANAL PARA TÍTULOS, DESCRIÇÕES E TAGS (siga à risca):
Objetivo: não resumir o corte, e sim achar o MOTIVO MAIS INTERESSANTE para alguém clicar, com a
qualidade de um editor humano que entendeu a live: contexto, melhor gancho, personalidade em
destaque, curiosidade sem inventar nem exagerar.

1. CONTEXTO DA LIVE: use também o que vem ANTES e DEPOIS do corte (transcrição ao redor e mapa
   de assuntos da live, quando vierem no pedido) para entender: o que estava acontecendo, quem
   participa, qual era o assunto, o que levou ao momento, a reação das pessoas, se houve surpresa,
   descoberta, brincadeira, discussão ou reviravolta, um detalhe dito antes que explica o momento
   e o desfecho. O contexto serve para ENTENDER; o título só promete o que aparece NO CORTE.

2. MELHOR GANCHO (responda para si antes de escrever): qual é o acontecimento principal? qual o
   detalhe mais curioso ou surpreendente? qual a reação mais interessante? alguma fala chama mais
   atenção que o próprio acontecimento? o que faria um fã do criador querer assistir? que
   informação desperta curiosidade sem entregar tudo? algum detalhe do contexto deixa o título
   mais específico? O título explora o melhor gancho, não adjetivos.
   Ex.: numa fuga da polícia, em vez de "CORINGA FEZ UMA FUGA INSANA NO GTA 6", descubra o que
   tornou a fuga diferente (o caminho inesperado, a polícia quase pegando, a reação dele, algo
   que deu errado no meio) e use isso.

3. TÍTULOS ("titulos": exatamente 3 opções, em MAIÚSCULAS, até 70 caracteres, sem hashtag):
- Personalidade principal no começo quando fizer sentido ("CORINGA DESCOBRIU UMA FORMA
  INESPERADA DE ESCAPAR DA POLÍCIA", "TAINÁ NÃO CONSEGUIU ACREDITAR NA RESPOSTA DO CORINGA").
  Se o acontecimento for bem mais forte que a pessoa, ele pode vir primeiro.
- Nada genérico: "MOMENTO INSANO", "FUGA MAIS LOUCA", "TROCAÇÃO DE TIRO ÉPICA", "BASTIDORES
  INSANOS", "SITUAÇÃO INACREDITÁVEL", "MOMENTO IMPRESSIONANTE", "ACONTECEU ALGO INESPERADO" só com
  motivo concreto. Troque adjetivo por informação específica (quem, o que estava em jogo, o que
  tornou aquilo interessante). Se a fala não mostra um diferencial, procure outro ângulo
  VERDADEIRO; nunca invente detalhe para encher o título.
- NUNCA invente: conversa sobre aposta não é aposta cumprida; discussão não é briga; jogada boa não
  é vitória; "primeira vez" só se for confirmado. Nada que o vídeo não cumpra.
- Curiosidade sem entregar o desfecho, mas claro o bastante para entender o assunto. Equilíbrio
  entre clareza, curiosidade, personalidade, especificidade e fidelidade.
- Varie a construção (não sempre "FULANO FEZ/ENCONTROU/FICOU/SE IMPRESSIONOU..."): afirmação,
  pergunta, reação, descoberta, situação específica. Pergunta só quando funciona melhor.
- Curto e fácil de ler no celular: sem explicação longa, palavra inútil, nome repetido ou excesso
  de adjetivo.
- As 3 opções são ÂNGULOS DIFERENTES, não variações da mesma frase. Referência: (1) o
  acontecimento principal; (2) o detalhe curioso que torna aquilo interessante; (3) a reação de
  alguém ou a consequência. Use outros ângulos se representarem melhor o vídeo.
- "melhor" (1, 2 ou 3) pesando curiosidade, clareza, força do acontecimento, reconhecimento da
  personalidade, naturalidade, fidelidade e o público do canal. NÃO escolha a mais exagerada.
  "porque_titulo" = o motivo em uma frase.
- Cortes da mesma live (a lista vem no pedido): cada título traz o diferencial DESTE corte, com
  gancho e estrutura diferentes dos outros. Se dois cortes mostram coisas parecidas, use o
  detalhe específico de cada um em vez de forçar variação artificial.
- Short: um acontecimento só, título que funciona sem ter visto a live. Longo: a atividade ou
  acontecimento principal da experiência, sem virar lista de assuntos.

4. DESCRIÇÃO ("descricao"), natural e específica deste corte:
- 1º parágrafo: quem participa, o jogo/contexto da live e o assunto principal.
- 2º parágrafo: o acontecimento do corte e um convite para assistir, sem exagero e sem entregar
  tudo.
- Última linha: poucas hashtags relevantes (3 a 4, ex.: "#Coringa #GTA6 #Shorts"; #Shorts só em
  curto). Hashtag NUNCA no título.
- Não copie o título com palavras a mais, não invente participante ou fato, nada genérico que
  serviria para qualquer corte.

5. TAGS ("tags", campo de tags do YouTube Studio): de 8 a 15, sem #, grafia normal: criador e
   apelidos/variações de escrita, participantes, jogo (e variações, ex.: "GTA 6", "GTA VI"),
   evento, assunto específico, termos do acontecimento, canal/grupo quando relevante (ex.:
   "Coringa", "Loud Coringa", "Coringa GTA 6", "GTA 6 perseguição", "cortes Coringa"). Relevância
   acima de quantidade; nada aleatório ou só popular. Tag não é hashtag.

6. THUMBNAIL ("thumbnail"): direção curta que COMPLEMENTA o título (não repete a frase): expressão
   forte e natural, rosto do criador em destaque, elementos do acontecimento, no máximo 2 ou 3
   pontos focais, texto opcional de poucas palavras.

PÚBLICO DO CANAL (23/11/2026, dados do YouTube Studio do canal; vale para os títulos e para a
   escolha dos cortes):
- Quem assiste o canal é, antes de tudo, público do CORINGA. Os cortes que mais rendem são dele:
  fugas, susto/medo, reações, resenha e momentos de casal com a Tainá, exploração do GTA 6 e
  conflito claro. Ex. que deram certo: "CORINGA FICOU COM MEDO DO FUNDO DO MAR NO GTA 6",
  "TAINÁ COLOCOU KIBE NO TOP 3 E O CORINGA NÃO ACEITOU", "CORINGA EXPÕE MENTIRA DO LUPAC AO VIVO".
  O que eles têm em comum: QUEM + um conflito, reação ou situação concreta entendida em 1 segundo.
- Corte em que o Coringa está no momento (confirmado pela fala ou pelo contexto): o nome CORINGA
  vai no título, de preferência no começo; a Tainá também, quando faz parte do momento.
- Corte de OUTRO criador, sem o Coringa: o público do canal não clica pelo nome dele. O título se
  apoia na SITUAÇÃO: conflito claro, reação cômica evidente, algo absurdo, o que estava em jogo
  ou o resultado que dá curiosidade. O nome entra como apoio, sem abrir o título se a situação
  for mais forte. Se houver ligação REAL com o Coringa ou a Tainá (estão juntos, falam dele,
  mesmo evento), use. Evite gameplay sem narrativa evidente (ex. fraco: "ALLAN TENTOU BANCAR O
  JUSTICEIRO NO TRÂNSITO"): diga o conflito, a consequência ou a reação. Na escolha, com outro
  criador seja mais exigente: só momentos com conflito, reação ou absurdo claros.
- Tags quase não pesam na descoberta: o que decide é o gancho inicial e o tema. Capriche no
  título e no começo do corte.

CATEGORIA NOS TEXTOS (21/11; orienta a abordagem, não é fórmula de título): HYPE destaca a
   tensão, o risco ou o momento decisivo; ENGRAÇADO, a situação cômica, a piada ou a reação que
   faz rir; ÉPICO, a habilidade, a dificuldade ou o feito; CURIOSIDADE, o detalhe ou a descoberta;
   REAÇÃO, a reação da personalidade (só quando ela é mesmo o atrativo); POLÊMICA, a opinião ou o
   conflito real, sem inflar; HISTÓRIA, o começo da situação sem entregar o desfecho; BASTIDORES,
   o que acontece fora da atividade principal.

7. ANTES DE ENTREGAR, confira e reescreva o que falhar: o título dá um motivo real para assistir?
   é específico ou serviria para dezenas de cortes? usou o melhor detalhe? o nome está bem
   posicionado? é natural? promete algo que o vídeo não cumpre? as 3 opções têm ângulos
   diferentes? a descrição contextualiza sem inventar? hashtags só na descrição? tags relevantes?
   o título difere dos outros cortes da live? existe alternativa mais interessante? Gramática
   certa não basta: título genérico se reescreve.

TOM: português do Brasil natural e direto; chamativo sem exagero. NENHUM emoji em título,
descrição, hashtags, tags ou thumbnail.

"analise": 1 ou 2 frases: o acontecimento principal e o melhor gancho escolhido (e por quê).
"duvida": se faltar algo essencial (ex.: não dá para saber quem é o convidado), diga o que falta
em vez de inventar; se não faltar nada, deixe vazio.`;

// 21/11/2026 (pedido do dono, "evolução do painel de cortes"): o tipo do momento (categoria) e a
// qualidade (critérios A-H) passam a ser avaliados SEPARADOS. A nota de 0 a 100 deixa de ser um
// número "no olho" da IA: o código calcula a partir dos critérios (notaDosCriterios).
const CATEGORIAS = ['hype', 'engracado', 'epico', 'curiosidade', 'reacao', 'polemica', 'historia', 'bastidores', 'outro'];
const CLASSIFICACAO = `TIPO DO MOMENTO ("categoria": UMA só, a principal = o motivo pelo qual vale assistir):
- hype: intensidade, tensão ou expectativa (perseguição, troca de tiro, disputa importante,
  momento decisivo, algo que pode dar muito errado, espera por um resultado, reviravolta).
- engracado: humor (piada espontânea, brincadeira entre participantes, resposta inesperada,
  situação constrangedora, reação engraçada, erro ou acontecimento absurdo).
- epico: impressiona pela habilidade, dificuldade ou importância (jogada muito difícil, vitória
  inesperada, feito impressionante, alguém carregando a equipe, momento memorável no jogo).
- curiosidade: dá vontade de descobrir ou entender (descoberta inesperada, detalhe escondido no
  jogo, situação estranha, informação surpreendente, mistério).
- reacao: a reação da personalidade é o atrativo principal (susto, surpresa, risada espontânea,
  indignação, empolgação, incredulidade).
- polemica: conflito ou opinião forte DE VERDADE (discussão, provocação, discordância, opinião
  controversa, confronto verbal). Conversa comum não é polêmica.
- historia: narrativa com começo, desenvolvimento e desfecho (relato, situação que começa de um
  jeito e termina de outro).
- bastidores: fora da atividade principal (preparação da live, organização de evento, conversa
  antes de começar, algo que aconteceu fora do jogo).
- outro: não se encaixa com segurança em nenhuma.
Escolha pelo conteúdo real. Gameplay (GTA ou outro) NÃO é automaticamente hype ou épico: pode
ser engraçado, curiosidade, reação ou história. Empate: a que é o principal atrativo para o
público. "categoria_porque" = o motivo em 1 frase. "acontecimento" = o que acontece no corte, em
1 frase concreta (quem, o quê).

QUALIDADE ("criterios", de 0 a 10 cada; é separada da categoria: um corte engraçado pode ser fraco):
- forca: o momento chama atenção de verdade ou é conversa comum?
- contexto: quem não viu a live entende o que está acontecendo?
- desenvolvimento: a situação evolui durante o corte?
- desfecho: há conclusão, reação, surpresa ou resultado que recompensa quem assistiu até o fim?
- retencao: os 2 primeiros segundos já têm fala ou ação de impacto, e o corte segura até o final?
- compartilhamento: alguém mandaria isso para um amigo?
- autonomia: funciona sozinho ou depende de algo que ficou fora do corte?
- diferencial: tem algo que o diferencia dos outros cortes desta live?
Avalie o que ACONTECEU, não as palavras: "isso foi insano" não torna o momento interessante.
Seja exigente: 8 ou mais só para o que é forte de verdade; conversa comum fica em 3-5.
Você lê SÓ o texto da live: não invente avaliação de imagem ou de som. Se algo importante não dá
para julgar pelo texto (ação de jogo sem fala, expressão, um som), diga em "limitacao"; se o
texto basta, deixe vazio.

VARIEDADE: uma live rende tipos diferentes de corte. Os melhores momentos vêm primeiro, mas
reconheça também curiosidade, história, bastidores etc. quando forem bons. NÃO crie corte fraco
para preencher categoria. NÃO escolha dois cortes do mesmo acontecimento, nem um que dependa do
mesmo momento de outro para fazer sentido (os cortes já feitos nesta live vêm no pedido, com
categoria e acontecimento).`;

const SISTEMA = `Você é editor-chefe de um canal brasileiro de CORTES de lives e vídeos de criadores
(YouTube, Shorts, TikTok, Reels). Seu trabalho: ler a transcrição com tempos, marcar os trechos
que viram cortes com alto CTR e alta retenção e escrever os textos de publicação de cada um.

Regras dos cortes:
- Use só o que está na transcrição. Os tempos que você devolve têm que existir nela.
- Um corte precisa se sustentar sozinho: quem não viu a live entende.
- Evite: silêncio, leitura de chat sem contexto, propaganda, pausas, papo arrastado.
- Qualidade acima de quantidade. Se o trecho não tem nada bom, devolva lista vazia.
- Gancho: a frase falada ou situação dos primeiros 2 segundos que segura quem está rolando o feed.
  "gancho_inicio" e "gancho_fim" = onde essa frase é dita no vídeo (HH:MM:SS, dentro do corte,
  de 2 a 20 segundos), tirados da transcrição.
- CURTO COMEÇA NO GANCHO (23/11, dados do YouTube Studio do canal: no feed de Shorts a pessoa
  decide em 2 segundos se fica, e os curtos que dão certo seguram 60-75% de quem viu o começo):
  o "inicio" do curto é o tempo do gancho (no máximo 1 segundo antes). Comece já na fala mais
  absurda, no susto, na reação ou no conflito. Nada de cumprimento, "então...", silêncio,
  carregamento, explicação ou preparação no começo. Se o momento precisa de contexto, o
  contexto vem DEPOIS do gancho, dentro do corte; se não funciona assim, escolha outro momento.
  O gancho tem que ser forte sozinho: frase de impacto, susto, reação ou conflito, não uma fala
  comum que só faz sentido mais tarde.
- Tempos no formato HH:MM:SS, contados desde o começo do vídeo.
- Personalidade principal: o dono do canal, salvo se o contexto/transcrição mostrar outra.

${CLASSIFICACAO}

${PADRAO}`;

// Campos de texto de publicação (iguais no roteiro e no "Refazer textos").
const TEXTOS = {
  analise: { type: 'STRING', description: 'acontecimento principal e melhor gancho, 1-2 frases' },
  titulos: { type: 'ARRAY', items: { type: 'STRING' }, description: 'exatamente 3 títulos em MAIÚSCULAS, ângulos diferentes' },
  melhor: { type: 'INTEGER', description: '1, 2 ou 3' },
  porque_titulo: { type: 'STRING' },
  descricao: { type: 'STRING' },
  tags: { type: 'ARRAY', items: { type: 'STRING' } },
  thumbnail: { type: 'STRING' },
  duvida: { type: 'STRING' },
};
const REQ_TEXTOS = ['analise', 'titulos', 'melhor', 'porque_titulo', 'descricao', 'tags', 'thumbnail'];
// 21/11: tipo do momento + qualidade por critério (iguais no roteiro e no "Classificar com a IA").
const NOMES_CRITERIOS = ['forca', 'contexto', 'desenvolvimento', 'desfecho', 'retencao', 'compartilhamento', 'autonomia', 'diferencial'];
// Peso de cada critério na nota de 0 a 100 (soma 1). Explicado ao dono em 21/11; mudar aqui muda
// só os cortes classificados daqui em diante.
export const PESOS = { forca: 0.20, retencao: 0.15, desfecho: 0.15, autonomia: 0.15, contexto: 0.10, desenvolvimento: 0.10, compartilhamento: 0.10, diferencial: 0.05 };
const CLASSE = {
  categoria: { type: 'STRING', enum: CATEGORIAS },
  categoria_porque: { type: 'STRING' },
  acontecimento: { type: 'STRING' },
  criterios: {
    type: 'OBJECT',
    properties: Object.fromEntries(NOMES_CRITERIOS.map((k) => [k, { type: 'INTEGER', description: '0 a 10' }])),
    required: NOMES_CRITERIOS,
  },
  limitacao: { type: 'STRING' },
};
const REQ_CLASSE = ['categoria', 'categoria_porque', 'acontecimento', 'criterios'];
const CORTE = {
  type: 'OBJECT',
  properties: {
    inicio: { type: 'STRING', description: 'HH:MM:SS' },
    fim: { type: 'STRING', description: 'HH:MM:SS' },
    gancho: { type: 'STRING' },
    gancho_inicio: { type: 'STRING', description: 'HH:MM:SS em que o gancho começa a ser dito' },
    gancho_fim: { type: 'STRING', description: 'HH:MM:SS em que o gancho termina' },
    ...CLASSE,
    ...TEXTOS,
  },
  // 17/11: gancho_inicio/gancho_fim passaram a ser obrigatorios: opcionais, o Gemini quase
  // sempre deixava de fora (cortes chegavam sem o tempo do gancho).
  required: ['inicio', 'fim', 'gancho', 'gancho_inicio', 'gancho_fim', ...REQ_CLASSE, ...REQ_TEXTOS],
};
const ESQ_TEXTOS = { type: 'OBJECT', properties: TEXTOS, required: REQ_TEXTOS };
const ESQ_CLASSE = { type: 'OBJECT', properties: CLASSE, required: REQ_CLASSE };
const ESQ_TRECHO = {
  type: 'OBJECT',
  properties: {
    assuntos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { inicio: { type: 'STRING' }, fim: { type: 'STRING' }, assunto: { type: 'STRING' }, forca: { type: 'INTEGER' } },
        required: ['inicio', 'fim', 'assunto', 'forca'],
      },
    },
    curtos: { type: 'ARRAY', items: CORTE },
  },
  required: ['assuntos', 'curtos'],
};
const ESQ_LONGOS = { type: 'OBJECT', properties: { longos: { type: 'ARRAY', items: CORTE } }, required: ['longos'] };

export class ErroRoteiro extends Error {
  constructor(msg, { esperar_s, definitivo, aviso } = {}) { super(msg); this.esperar_s = esperar_s; this.definitivo = definitivo; this.aviso = aviso; }
}

// Faz o proximo passo do roteiro deste video. Devolve { concluido, progresso }.
export async function passoRoteiro(env, tarefa) {
  if (!env.GEMINI_API_KEY) throw new ErroRoteiro('Falta a chave GEMINI_API_KEY no Cloudflare (a mesma da Jean).', { definitivo: true });
  const base = db(env);
  const video = await base.first('SELECT id, usuario_id, titulo, canal, plataforma, duracao_s, analisar_de_s, roteiro_de_s, contexto FROM cortex_videos WHERE id = ?', tarefa.video_id);
  if (!video) throw new ErroRoteiro('vídeo não existe mais', { definitivo: true });
  const ext = await base.first('SELECT MAX(fim_s) AS fim, COUNT(*) AS n FROM cortex_transcricao WHERE video_id = ?', video.id);
  if (!ext || !ext.n) throw new ErroRoteiro('o vídeo não tem transcrição; use "Tentar de novo" na etapa de texto', { definitivo: true });

  // 16/11: com "analisar de" marcado, a transcricao comeca no meio do video; os trechos da IA
  // partem dali (nada de passos lendo horas vazias). `dur` = onde o texto termina.
  // 18/11: depois de "Puxar o resto", roteiro_de_s = onde comeca a parte nova (so ela e lida).
  const base0 = Math.max(0, Number(video.roteiro_de_s ?? video.analisar_de_s) || 0);
  video.base0 = base0;
  const dur = Math.max(Number(ext.fim) || 0, base0 + 60);
  const span = dur - base0;
  const n = Math.max(1, Math.round(span / TRECHO_S));
  const passo = span / n;
  const comLongos = span >= MIN_LONGOS_S;
  const totalPassos = n + (comLongos ? 1 : 0);
  const feitas = await base.all('SELECT parte, resumo, cortes FROM cortex_roteiro_partes WHERE video_id = ? ORDER BY parte', video.id);
  const proxima = feitas.length ? Math.max(...feitas.map((f) => f.parte)) + 1 : 0;
  const agora = new Date().toISOString();
  let cortesAte = feitas.reduce((s, f) => s + (f.cortes || 0), 0);

  if (proxima < totalPassos) {
    let r;
    if (proxima < n) {
      const ini = Math.floor(base0 + proxima * passo), fim = proxima === n - 1 ? Math.ceil(dur) + 1 : Math.floor(base0 + (proxima + 1) * passo);
      // 30 s de folga antes do trecho: um momento que comeca na divisa nao se perde.
      const linhas = await base.all(
        'SELECT inicio_s, fim_s, texto FROM cortex_transcricao WHERE video_id = ? AND inicio_s >= ? AND inicio_s < ? ORDER BY inicio_s',
        video.id, Math.max(base0, ini - 30), fim);
      r = await lerTrecho(env, video, linhas, ini, fim, proxima, n);
      await gravar(env, video, proxima, ini, fim, r, agora);
    } else {
      const assuntos = feitas.flatMap((f) => { try { return JSON.parse(f.resumo || '[]'); } catch { return []; } });
      r = await escolherLongos(env, video, assuntos, base0, dur);
      await gravar(env, video, proxima, base0, Math.ceil(dur), r, agora);
    }
    cortesAte += r.cortes.length;
  }

  const feitos = Math.min(proxima + 1, totalPassos);
  if (feitos >= totalPassos) {
    await base.batch([
      ["UPDATE cortex_videos SET etapa = 'cortado', erro = NULL, atualizado_em = ? WHERE id = ? AND etapa = 'roteiro'", [agora, video.id]],
      ["UPDATE cortex_tarefas SET estado = 'feita', progresso = NULL, erro = NULL, atualizada_em = ? WHERE id = ?", [agora, tarefa.id]],
      // 19/11: roteiro pronto -> o PC tira a foto de cada curto (cena + previa do vertical)
      pedirFotos(video.usuario_id, video.id, agora),
    ]);
    return { concluido: true, cortes: cortesAte, progresso: `roteiro pronto: ${cortesAte} cortes` };
  }
  const prox = feitos < n ? `IA lendo trecho ${feitos + 1} de ${n}` : 'IA escolhendo os cortes longos';
  const progresso = `${prox} · ${cortesAte} ${cortesAte === 1 ? 'corte' : 'cortes'} até agora`;
  const prazo = new Date(Date.now() + 20 * 60000).toISOString();
  await base.run('UPDATE cortex_tarefas SET progresso = ?, pega_ate = ?, atualizada_em = ? WHERE id = ?', progresso, prazo, agora, tarefa.id);
  return { concluido: false, cortes: cortesAte, progresso };
}

async function gravar(env, video, parte, ini, fim, r, agora) {
  const lotes = [[
    `INSERT INTO cortex_roteiro_partes (video_id, parte, inicio_s, fim_s, resumo, cortes, modelo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (video_id, parte) DO NOTHING`,
    [video.id, parte, ini, fim, JSON.stringify(r.assuntos || []), r.cortes.length, r.modelo, agora]]];
  for (const c of r.cortes) {
    lotes.push([
      `INSERT INTO cortex_cortes (video_id, usuario_id, tipo, origem, inicio_s, fim_s, titulo, descricao, tags, gancho, gancho_inicio_s, gancho_fim_s, motivo, nota,
                                  titulos, titulo_porque, thumb, duvida, categoria, categoria_porque, acontecimento, criterios, limitacao,
                                  estado, criado_em, atualizado_em)
       VALUES (?, ?, ?, 'ia', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?)`,
      [video.id, video.usuario_id, c.tipo, c.inicio_s, c.fim_s, c.titulo, c.descricao, JSON.stringify(c.tags), c.gancho,
       c.gancho_inicio_s, c.gancho_fim_s, c.motivo, c.nota, JSON.stringify(c.titulos), c.titulo_porque, c.thumb, c.duvida,
       c.categoria, c.categoria_porque, c.acontecimento, c.criterios, c.limitacao, agora, agora]]);
  }
  await db(env).batch(lotes);
}

async function lerTrecho(env, video, linhas, ini, fim, i, n) {
  const texto = linhas.map((l) => `[${hms(l.inicio_s)}] ${l.texto}`).join('\n');
  const usados = await titulosDaLive(env, video.id);
  const antes = i > 0 ? await mapaDaLive(env, video.id, ini) : '';
  const pedido = `${cabecalho(video)}${antes}${usados}
Trecho ${i + 1} de ${n}: de ${hms(ini)} a ${hms(fim)}.

Tarefa:
1. "assuntos": divida o trecho em assuntos/momentos de 2 a 10 minutos (inicio, fim, assunto em
   até 15 palavras, forca de 0 a 100 = quanto aquilo prende quem assiste). Cubra o trecho todo.
2. "curtos": de 0 a 4 cortes CURTOS de 45 a 90 segundos (vertical, Shorts/TikTok/Reels), só os
   que valem de verdade. O corte começa já no gancho, sem introdução: "inicio" = o tempo do
   gancho (no máximo 1 s antes), nunca o começo do assunto. Os 45 a 90 s contam A PARTIR do
   gancho: depois dele vêm o desenvolvimento e o desfecho ou a reação. Se o momento forte é o
   final de uma conversa longa, o gancho é uma fala forte do meio, não o desfecho (senão o
   corte fica curto demais).
   Para os textos de cada corte, use o resto do trecho (antes e depois dele) e o mapa da live
   como contexto, seguindo o padrão editorial.

Transcrição (cada linha começa com o tempo em que a fala começa):
${texto || '(trecho sem fala)'}`;
  const { dados, modelo } = await perguntar(env, pedido, ESQ_TRECHO);
  const assuntos = (Array.isArray(dados.assuntos) ? dados.assuntos : []).map((a) => ({
    i: seg(a.inicio), f: seg(a.fim), a: String(a.assunto || '').slice(0, 160), forca: limitar(a.forca),
  })).filter((a) => a.i !== null && a.f !== null && a.f > a.i && a.a).slice(0, 40);
  const cortes = limpar(dados.curtos, 'curto', Math.max(video.base0 || 0, ini - 30), fim + 90)
    .filter((c, k, todos) => !todos.slice(0, k).some((o) => sobrepoe(o, c)));
  // Nao repetir um curto que ja saiu no trecho anterior (folga de 30 s na divisa).
  const ja = await db(env).all("SELECT inicio_s, fim_s FROM cortex_cortes WHERE video_id = ? AND tipo = 'curto' AND origem = 'ia'", video.id);
  return { assuntos, cortes: cortes.filter((c) => !ja.some((o) => sobrepoe(o, c))), modelo };
}

async function escolherLongos(env, video, assuntos, ini, dur) {
  if (!assuntos.length) return { assuntos: [], cortes: [], modelo: null };
  const max = Math.max(1, Math.min(6, Math.floor((dur - ini) / (40 * 60))));
  const usados = await titulosDaLive(env, video.id);
  const linhas = assuntos.map((a) => `[${hms(a.i)} - ${hms(a.f)}] (força ${a.forca}) ${a.a}`).join('\n');
  const pedido = `${cabecalho(video)}${usados}
${ini > 0 ? `Parte analisada: de ${hms(ini)} a ${hms(dur)} (o começo do vídeo ficou de fora, de propósito).` : `Duração total: ${hms(dur)}.`}

Abaixo está o mapa de assuntos ${ini > 0 ? 'dessa parte' : 'do vídeo inteiro'} (já resumido por trechos).
Tarefa: "longos" = de 1 a ${max} cortes LONGOS de 30 a 40 minutos (vídeo horizontal no YouTube),
sem se sobrepor, cada um com um fio condutor (um tema, uma sequência, uma história). Comece e
termine em divisas de assunto. Prefira os blocos com mais força.

Mapa de assuntos:
${linhas}`;
  const { dados, modelo } = await perguntar(env, pedido, ESQ_LONGOS);
  const cortes = limpar(dados.longos, 'longo', ini, Math.ceil(dur) + 1)
    .filter((c, k, todos) => !todos.slice(0, k).some((o) => sobrepoe(o, c))).slice(0, max);
  return { assuntos: [], cortes, modelo };
}

function cabecalho(v) {
  return `Vídeo: ${v.titulo || '(sem título)'}
Canal: ${v.canal || '(desconhecido)'} · Plataforma: ${v.plataforma}` +
    (v.contexto ? `\nContexto da live (escrito pelo dono do canal, confie nele para nomes e situação): ${v.contexto}` : '');
}
// 19/11: títulos já usados nesta live, para a IA não repetir a mesma estrutura (padrão do dono).
// 21/11: vai junto o gancho que cada um usou (motivo), para este corte buscar outro ângulo.
async function titulosDaLive(env, videoId, menos) {
  // 21/11: com a categoria e o acontecimento, para a IA variar o tipo e não repetir o mesmo momento.
  const l = await db(env).all("SELECT inicio_s, fim_s, titulo, motivo, categoria, acontecimento FROM cortex_cortes WHERE video_id = ? AND estado <> 'descartado' AND id <> ? ORDER BY inicio_s LIMIT 40", videoId, menos || 0);
  return l.length ? '\nOutros cortes desta live (não repita o acontecimento, o gancho nem a estrutura do título):\n' +
    l.map((x) => `- [${hms(x.inicio_s)} - ${hms(x.fim_s)}]${x.categoria ? ' ' + x.categoria.toUpperCase() : ''} · ${x.titulo}` +
      (x.acontecimento ? ' · acontecimento: ' + String(x.acontecimento).slice(0, 160) : '') +
      (x.motivo ? ' · gancho: ' + String(x.motivo).slice(0, 140) : '')).join('\n') : '';
}
// 21/11 (novo padrão editorial): mapa de assuntos da live INTEIRA, que o roteiro já resumiu por
// trechos (cortex_roteiro_partes). Dá o contexto de antes e depois sem reler a transcrição toda.
async function mapaDaLive(env, videoId, antesDe) {
  const partes = await db(env).all('SELECT resumo FROM cortex_roteiro_partes WHERE video_id = ? ORDER BY parte', videoId);
  const lista = partes.flatMap((p) => { try { return JSON.parse(p.resumo || '[]'); } catch { return []; } })
    .filter((a) => a && a.a && (antesDe == null || a.i < antesDe)).sort((x, y) => x.i - y.i).slice(-120);
  if (!lista.length) return '';
  return `\nMapa de assuntos da live${antesDe != null ? ' até aqui' : ''} (só contexto; não é para cortar daqui):\n` +
    lista.map((a) => `[${hms(a.i)} - ${hms(a.f)}] ${a.a}`).join('\n');
}

// 21/11: categoria e critérios vindos da IA -> campos do corte. A nota (0-100) é a média
// ponderada dos critérios (PESOS) x 10; sem critérios válidos, fica null (quem chama decide).
export function notaDosCriterios(cr) {
  if (!cr) return null;
  let soma = 0;
  for (const [k, p] of Object.entries(PESOS)) { const v = Number(cr[k]); if (!Number.isFinite(v)) return null; soma += p * Math.min(10, Math.max(0, v)); }
  return Math.round(soma * 10);
}
function semAcento(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
export function lerClasse(c) {
  const cat = semAcento(c.categoria).replace(/[^a-z]/g, '');
  const cr = c.criterios && typeof c.criterios === 'object'
    ? Object.fromEntries(NOMES_CRITERIOS.map((k) => [k, Math.min(10, Math.max(0, Math.round(Number(c.criterios[k]))))]))
    : null;
  const crOk = cr && NOMES_CRITERIOS.every((k) => Number.isFinite(cr[k])) ? cr : null;
  return {
    categoria: CATEGORIAS.includes(cat) ? cat : (cat ? 'outro' : null),
    categoria_porque: semEmoji(c.categoria_porque).slice(0, 300) || null,
    acontecimento: semEmoji(c.acontecimento).slice(0, 300) || null,
    criterios: crOk ? JSON.stringify(crOk) : null,
    limitacao: semEmoji(c.limitacao).slice(0, 300) || null,
    nota: notaDosCriterios(crOk),
  };
}

// Textos de publicação vindos da IA -> campos do corte (sem emoji, título da opção "melhor").
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
function semEmoji(t) { return String(t || '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(); }
export function lerTextos(c) {
  const titulos = (Array.isArray(c.titulos) ? c.titulos : []).map((t) => semEmoji(t).replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR').slice(0, 120)).filter(Boolean).slice(0, 3);
  const k = Math.min(titulos.length, Math.max(1, Math.round(Number(c.melhor)) || 1)) - 1;
  return {
    titulo: titulos[k] || semEmoji(c.titulo).slice(0, 120) || null,
    titulos: titulos.length ? titulos : null,
    titulo_porque: semEmoji(c.porque_titulo).slice(0, 400) || null,
    descricao: semEmoji(c.descricao).slice(0, 3000) || null,
    tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => semEmoji(t).replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean)
      .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 15),
    thumb: semEmoji(c.thumbnail).slice(0, 800) || null,
    duvida: semEmoji(c.duvida).slice(0, 300) || null,
    motivo: semEmoji(c.analise || c.motivo).slice(0, 400) || null,
  };
}

// 19/11: "Refazer textos" de UM corte (botão na gaveta): lê a fala do trecho e devolve título(s),
// descrição, tags e thumbnail no padrão do canal. NÃO grava: o dono revisa e aperta Salvar.
export async function refazerTextos(env, corte, video) {
  const ctx = await contextoDoCorte(env, corte, video);
  const classe = corte.categoria
    ? `Categoria deste corte: ${corte.categoria.toUpperCase()}${corte.categoria_porque ? ' (' + corte.categoria_porque + ')' : ''}. Use-a para orientar a abordagem.\n` +
      (corte.acontecimento ? `Acontecimento principal: ${corte.acontecimento}\n` : '')
    : '';
  const pedido = `${ctx.topo}
Título atual (sugestão inicial; não troque à toa um título que já é bom): ${corte.titulo}
${corte.gancho ? 'Gancho: ' + corte.gancho + '\n' : ''}${classe}
Escreva os textos de publicação deste corte seguindo o padrão do canal.

${ctx.falas}`;
  const { dados } = await perguntar(env, pedido, ESQ_TEXTOS);
  return lerTextos(dados);
}

// 21/11: "Classificar com a IA" de UM corte (cortes de antes da categoria existir): devolve
// categoria, motivo, acontecimento, critérios, limitação e a nota calculada. Não mexe em título,
// tempo, legenda nem arquivo; quem grava é a rota (o dono apertou o botão).
export async function classificarCorte(env, corte, video) {
  const ctx = await contextoDoCorte(env, corte, video);
  const pedido = `${ctx.topo}
Título: ${corte.titulo}
${corte.gancho ? 'Gancho: ' + corte.gancho + '\n' : ''}
Este corte JÁ foi escolhido e não vai mudar. Tarefa: classificar o tipo do momento ("categoria",
"categoria_porque", "acontecimento"), dar os "criterios" de qualidade e, se for o caso, a
"limitacao", seguindo as regras de TIPO DO MOMENTO e QUALIDADE. Julgue SÓ a fala do corte; o
antes e o depois servem para entender o contexto.

${ctx.falas}`;
  const { dados } = await perguntar(env, pedido, ESQ_CLASSE);
  const cl = lerClasse(dados);
  if (!cl.categoria || cl.nota === null) throw new ErroRoteiro('A IA respondeu sem categoria ou sem critérios. Tente de novo.');
  return cl;
}

// Fala do corte (a legenda revisada, se houver; senão a transcrição) + 6 min antes e 3 min
// depois + mapa da live + outros cortes. Tudo da transcrição que o painel já tem.
async function contextoDoCorte(env, corte, video) {
  if (!env.GEMINI_API_KEY) throw new ErroRoteiro('Falta a chave GEMINI_API_KEY no Cloudflare (a mesma da Jean).', { definitivo: true });
  let fala = '';
  try {
    const ps = corte.legenda ? JSON.parse(corte.legenda) : null;
    if (Array.isArray(ps) && ps.length) {
      // legenda do corte (palavra a palavra): frases com o tempo do vídeo original
      let linha = [], ini = null; const out = [];
      for (const w of ps) {
        if (ini === null) ini = w.i;
        linha.push(w.p);
        if (linha.length >= 14 || /[.!?…]$/.test(w.p)) { out.push(`[${hms(corte.inicio_s + ini)}] ${linha.join(' ')}`); linha = []; ini = null; }
      }
      if (linha.length) out.push(`[${hms(corte.inicio_s + ini)}] ${linha.join(' ')}`);
      fala = out.join('\n');
    }
  } catch { fala = ''; }
  if (!fala) {
    const linhas = await db(env).all(
      'SELECT inicio_s, texto FROM cortex_transcricao WHERE video_id = ? AND fim_s > ? AND inicio_s < ? ORDER BY inicio_s',
      video.id, corte.inicio_s, corte.fim_s);
    fala = linhas.map((l) => `[${hms(l.inicio_s)}] ${l.texto}`).join('\n');
  }
  if (!fala) throw new ErroRoteiro('Não há texto deste trecho para a IA ler (use "Transcrever para revisar" na legenda).');
  const usados = await titulosDaLive(env, video.id, corte.id);
  const mapa = await mapaDaLive(env, video.id);
  // 21/11: a fala de ANTES (6 min) e DEPOIS (3 min) do corte, da transcrição que o painel já tem
  // (nada é transcrito de novo), para entender o que levou ao momento e o desfecho.
  const ao = await db(env).all(
    'SELECT inicio_s, fim_s, texto FROM cortex_transcricao WHERE video_id = ? AND ((fim_s > ? AND inicio_s < ?) OR (fim_s > ? AND inicio_s < ?)) ORDER BY inicio_s',
    video.id, corte.inicio_s - 360, corte.inicio_s, corte.fim_s, corte.fim_s + 180);
  const ln = (l) => `[${hms(l.inicio_s)}] ${l.texto}`;
  const antesTx = ao.filter((l) => l.fim_s <= corte.inicio_s).map(ln).join('\n').slice(-12000);
  const depoisTx = ao.filter((l) => l.inicio_s >= corte.fim_s).map(ln).join('\n').slice(0, 6000);
  return {
    topo: `${cabecalho(video)}${mapa}${usados}

Corte ${corte.tipo === 'longo' ? 'LONGO (vídeo horizontal no YouTube)' : 'CURTO (Short vertical)'} de ${hms(corte.inicio_s)} a ${hms(corte.fim_s)}.`,
    falas: `${antesTx ? `Contexto: fala ANTES do corte (não está no vídeo publicado):\n${antesTx}\n\n` : ''}Fala DO CORTE (é isto que o público vai ver; cada linha começa com o tempo):
${fala.slice(0, 60000)}${depoisTx ? `\n\nContexto: fala DEPOIS do corte (não está no vídeo publicado; o título não pode prometer isto):\n${depoisTx}` : ''}`,
  };
}

// Valida o que veio da IA: tempo dentro do trecho, duracao dentro da faixa, campos aparados.
function limpar(lista, tipo, min, max) {
  const [dMin, dMax] = tipo === 'curto' ? [15, 180] : [5 * 60, 90 * 60];
  return (Array.isArray(lista) ? lista : []).map((c) => {
    let i = seg(c.inicio), f = seg(c.fim);
    if (i === null || f === null) return null;
    i = Math.max(min, Math.round(i)); f = Math.min(max, Math.round(f));
    if (f - i < dMin || f - i > dMax) return null;
    const tx = lerTextos(c);
    if (!tx.titulo) return null;
    const { gi, gf } = tempoGancho(c, tipo, i, f);
    // 23/11 (dados do Studio: o Short se decide nos 2 primeiros segundos): curto cujo gancho cai
    // mais de 3 s depois do começo passa a começar 1 s antes do gancho ("entrada fria" cortada),
    // desde que sobrem ao menos 40 s de corte (dono: com 20 s, um corte de 1 min virava 22 s).
    // Sobrando menos, o gancho é o clímax: o corte fica como a IA escolheu (o cartão avisa).
    if (tipo === 'curto' && gi != null && gi - i > 3 && f - (gi - 1) >= 40) i = gi - 1;
    const cl = lerClasse(c);
    return {
      gancho_inicio_s: gi, gancho_fim_s: gf,
      tipo, inicio_s: i, fim_s: f, ...tx, ...cl,
      gancho: semEmoji(c.gancho).slice(0, 300) || null,
      nota: cl.nota ?? limitar(c.nota),
    };
  }).filter(Boolean);
}

// Tempo do gancho. 15/11 descartava qualquer tempo fora do corte, e quase todos caiam fora:
// a transcricao vem em blocos de ~30 s, entao a IA aponta o comeco do BLOCO (alguns segundos
// antes do corte). 17/11: tempo perto do corte (ate 30 s fora) e trazido para dentro; sem
// tempo nenhum, o CURTO usa o proprio comeco (a regra do roteiro e "o corte comeca no gancho")
// e a duracao estimada pela frase (~2,5 palavras/s). Longo sem tempo continua vazio.
export function tempoGancho(c, tipo, i, f) {
  const fala = Math.min(15, Math.max(2, Math.round(String(c.gancho || '').split(/\s+/).filter(Boolean).length / 2.5)));
  let gi = seg(c.gancho_inicio), gf = seg(c.gancho_fim);
  if (gi !== null && (gi < i - 30 || gi >= f)) gi = null;
  if (gi === null) {
    if (tipo !== 'curto') return { gi: null, gf: null };
    gi = i; gf = null;
  }
  gi = Math.max(i, Math.round(gi));
  if (gf === null || gf <= gi || gf - gi > 60) gf = gi + fala;
  gf = Math.min(f, Math.round(gf));
  if (gf - gi < 1) return { gi: null, gf: null };
  return { gi, gf };
}

function sobrepoe(a, b) {
  const ai = a.inicio_s, af = a.fim_s, bi = b.inicio_s, bf = b.fim_s;
  const comum = Math.min(af, bf) - Math.max(ai, bi);
  return comum > 0.5 * Math.min(af - ai, bf - bi);
}
function limitar(n) { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null; }
export function hms(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
}
export function seg(t) {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  const m = String(t || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,]\d+)?$/);
  if (!m) return null;
  return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------------------------------------------------------------- Gemini (plano gratis)
// Modelos trocaveis sem codigo: CORTEX_MODELO e CORTEX_MODELO_RESERVA no Pages.
// CORTEX_GEMINI_URL so existe para o teste local com um Google de mentira.
// Configuracoes da mais completa para a mais simples: se o Google recusar uma (400), cai
// para a seguinte em vez de falhar.
// 19/11: `opc.sistema` troca o papel da IA e `opc.imagem` ({ tipo, base64 }) manda uma foto
// junto (cena.js: qual e a cena do corte). Sem `opc`, e o roteiro de sempre.
export async function perguntar(env, pedido, esquema, opc = {}) {
  const modelos = [env.CORTEX_MODELO || 'gemini-3.8-flash', env.CORTEX_MODELO_RESERVA || 'gemini-3.5-flash-lite'];
  // 22/11: 8192 -> 16384. Desde 21/11 cada corte volta com categoria, motivo e 8 critérios além dos
  // textos; com o "pensamento" contando no mesmo limite, um trecho com 4 curtos podia vir cortado
  // ("fora do formato") e cair nas tentativas seguintes (até 6, de até 2,5 min cada).
  const configs = [
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'LOW' } },
    { responseMimeType: 'application/json', responseSchema: esquema, maxOutputTokens: 16384 },
    { responseMimeType: 'application/json', maxOutputTokens: 16384 },
  ];
  // 18/11: "ocupado" = falha passageira do Google (503 alta demanda, 500/502/504, rede, demora).
  // Antes contava como falha e, depois de 3, o video parava com erro; agora o PC espera e repete.
  let esperar = 0, ultimoErro = '', ocupado = false;
  for (const modelo of modelos) {
    for (let c = 0; c < configs.length; c++) {
      const corpo = {
        systemInstruction: { parts: [{ text: opc.sistema || SISTEMA }] },
        contents: [{ role: 'user', parts: [
          ...(opc.imagem ? [{ inlineData: { mimeType: opc.imagem.tipo, data: opc.imagem.base64 } }] : []),
          { text: pedido + (c === 2 ? '\n\nResponda SÓ com o JSON, no formato: ' + JSON.stringify(esquema) : '') }] }],
        generationConfig: configs[c],
      };
      let r;
      try {
        r = await fetch((env.CORTEX_GEMINI_URL || URL_BASE) + encodeURIComponent(modelo) + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(PRAZO_GEMINI_MS),
        });
      } catch (e) {
        ultimoErro = `${modelo}: ${e.name === 'TimeoutError' ? 'demorou demais' : 'falha de rede'}`;
        ocupado = true;
        break;   // proximo modelo
      }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const cand = (j.candidates || [])[0] || {};
        const texto = ((cand.content || {}).parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        const dados = lerJson(texto);
        if (dados) return { dados, modelo };
        ultimoErro = `${modelo}: resposta fora do formato (${cand.finishReason || 'sem motivo'})`;
        break;
      }
      const msg = String((j.error && j.error.message) || r.status).slice(0, 160);
      if (r.status === 400 && c < configs.length - 1) continue;          // tenta a config mais simples
      if (r.status === 401 || r.status === 403) throw new ErroRoteiro('O Google recusou a chave GEMINI_API_KEY. Confira no Cloudflare.', { definitivo: true });
      if (r.status === 429) { esperar = Math.max(esperar, atrasoPedido(j) || 60); ultimoErro = `${modelo}: limite do plano grátis`; break; }
      if ([500, 502, 503, 504].includes(r.status)) ocupado = true;
      ultimoErro = `${modelo}: ${r.status} ${msg}`;
      break;
    }
  }
  if (esperar) throw new ErroRoteiro('Limite do plano grátis do Gemini; o PC espera e tenta de novo.', { esperar_s: esperar, aviso: 'limite do Gemini grátis' });
  if (ocupado) throw new ErroRoteiro('Gemini sobrecarregado agora (' + ultimoErro.slice(0, 120) + '); o PC espera e tenta de novo.', { esperar_s: 90, aviso: 'Gemini sobrecarregado' });
  throw new ErroRoteiro('Gemini não respondeu: ' + ultimoErro);
}

function atrasoPedido(j) {
  const det = ((j.error || {}).details || []).find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const m = det && String(det.retryDelay || '').match(/([\d.]+)s/);
  return m ? Math.ceil(Number(m[1])) + 2 : 0;
}

function lerJson(t) {
  try { return JSON.parse(t); } catch { /* tenta recortar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ } }
  return null;
}
