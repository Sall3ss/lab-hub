// Tela do projeto "cortex". A API dele responde em /api/p/cortex/...
// (servidor em projetos/cortex/api.js).
//
// O quadro tem 7 colunas em duas metades:
//   V1 Entrada, V2 Transcrição, V3 Roteiro IA   -> cartão = vídeo (o que a nuvem e o PC fazem)
//   C1 Triagem, C2 Download, C3 Edição, C4 Publicado -> cartão = corte (o que o dono decide)
// Abaixo, a linha do tempo do vídeo selecionado, com os cortes nas faixas L (longos) e C (curtos).
// Nada grava sem o dono confirmar: "Marcar corte" só cria ao apertar Salvar.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.
(function () {
  var API = '/api/p/cortex';   // fotos dos curtos: deposito R2 lab-hub-arquivos ligado em 19/11/2026 (2a publicacao)
  var COLUNAS = [
    { id: 'entrada', faixa: 'V1', nome: 'Entrada', grupo: 'video' },
    { id: 'transcricao', faixa: 'V2', nome: 'Transcrição', grupo: 'video' },
    { id: 'roteiro', faixa: 'V3', nome: 'Roteiro IA', grupo: 'video' },
    { id: 'triagem', faixa: 'C1', nome: 'Triagem', grupo: 'corte' },
    { id: 'download', faixa: 'C2', nome: 'Download no PC', grupo: 'corte' },
    { id: 'edicao', faixa: 'C3', nome: 'Edição (Movavi)', grupo: 'corte' },
    { id: 'publicado', faixa: 'C4', nome: 'Publicado', grupo: 'corte' },
  ];
  var VAZIO = {
    entrada: 'Cole um link acima para começar.',
    transcricao: 'Nada transcrevendo agora.',
    roteiro: 'Nenhum vídeo com a IA.',
    triagem: 'Os cortes sugeridos pela IA aparecem aqui para você aprovar.',
    download: 'Aprovou? O PC baixa só os minutos do corte.',
    edicao: 'Arquivos prontos no PC para abrir no Movavi.',
    publicado: 'O que já foi postado.',
  };
  var PLAT = { youtube: 'YT', twitch: 'TW', kick: 'KK' };
  var NOME_PLAT = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick' };

  var $ = function (id) { return document.getElementById(id); };
  var quadroEl = $('quadro');
  var estado = { videos: [], cortes: [], pc: { online: false }, layouts: [] };
  var selVideo = null;        // id do vídeo na linha do tempo
  var detalhe = null;         // { video, cortes } do vídeo selecionado
  var gavetaAberta = null;    // função que redesenha a gaveta (ou null)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dois(n) { return (n < 10 ? '0' : '') + n; }
  function tc(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    return dois(Math.floor(s / 3600)) + ':' + dois(Math.floor((s % 3600) / 60)) + ':' + dois(s % 60);
  }
  function duracao(s) {
    s = Math.round(s);
    if (s < 60) return s + 's';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + 'h' + dois(m) : m + 'min' + (x ? dois(x) + 's' : '');
  }
  // "1:02:03", "62:03", "3723" -> segundos (null se inválido)
  function lerTC(t) {
    t = String(t || '').trim();
    if (!t) return null;
    if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
    var p = t.split(':').map(Number), s = 0;
    for (var i = 0; i < p.length; i++) s = s * 60 + p[i];
    return s;
  }
  // máscara de timecode: só dígitos e ":", e completa os ":" ao sair do campo
  function mascaraTC(el, aoMudar) {
    el.addEventListener('input', function () { this.value = this.value.replace(/[^\d:]/g, '').slice(0, 8); if (aoMudar) aoMudar(); });
    el.addEventListener('blur', function () { var s = lerTC(this.value); if (s != null) this.value = tc(s); });
  }
  // "Começar em…" (16/11): lê os dois campos -> { de, ate } em segundos, ou { erro }.
  function lerCamposTrecho(elDe, elAte) {
    var de = elDe.value.trim() ? lerTC(elDe.value) : null, ate = elAte.value.trim() ? lerTC(elAte.value) : null;
    if ((elDe.value.trim() && de == null) || (elAte.value.trim() && ate == null)) return { erro: 'Tempo do trecho inválido. Use HH:MM:SS.' };
    if (ate != null && ate - (de || 0) < 120) return { erro: 'O "até" precisa vir pelo menos 2 min depois do "a partir de".' };
    return { de: de || null, ate: ate };
  }
  function textoTrecho(v) {
    if (!v.analisar_de_s && !v.analisar_ate_s) return '';
    return (v.analisar_de_s ? tc(v.analisar_de_s) : '00:00:00') + ' → ' + (v.analisar_ate_s ? tc(v.analisar_ate_s) : 'fim');
  }
  function data(iso) {
    try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  // ---------- API ----------
  function irParaEntrar() { location.replace('/entrar/?volta=' + encodeURIComponent(location.pathname + location.search)); }
  function api(caminho, opc) {
    opc = opc || {};
    var init = { method: opc.metodo || 'GET', headers: {}, credentials: 'same-origin' };
    if (opc.corpo !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opc.corpo); }
    return fetch(API + caminho, init).then(function (r) {
      if (r.status === 401) { irParaEntrar(); throw new Error('sessão expirada'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.erro || 'Não foi possível concluir (erro ' + r.status + ').'); e.status = r.status; e.dados = j; throw e; }
        return j;
      });
    }, function () { throw new Error('Sem conexão. Confira a internet e tente de novo.'); });
  }

  var avisoT = null;
  function aviso(txt, erro) {
    var el = $('aviso');
    el.textContent = txt; el.className = 'aviso' + (erro ? ' erro' : ''); el.hidden = false;
    clearTimeout(avisoT); avisoT = setTimeout(function () { el.hidden = true; }, erro ? 6000 : 3000);
  }

  // ---------- relógio (timecode HH:MM:SS:FF, 30 fps) ----------
  function relogio() {
    var d = new Date();
    $('relogio').textContent = dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()) + ':' + dois(Math.floor(d.getMilliseconds() / 33.34));
    requestAnimationFrame(relogio);
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(function () { var d = new Date(); $('relogio').textContent = dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()) + ':00'; }, 1000);
  } else requestAnimationFrame(relogio);

  // ---------- importar link ----------
  function detectar(txt) {
    txt = String(txt || '').toLowerCase();
    if (/(youtube\.com|youtu\.be)/.test(txt)) return 'youtube';
    if (/twitch\.tv/.test(txt)) return 'twitch';
    if (/kick\.com/.test(txt)) return 'kick';
    return '';
  }
  $('link').addEventListener('input', function () {
    var p = detectar(this.value), el = $('plat');
    el.dataset.p = p; el.textContent = p ? NOME_PLAT[p].toUpperCase() : 'LINK';
    $('msg-link').textContent = ''; $('msg-link').className = 'ingest-msg';
  });
  // "Começar em…": campos aparecem só quando pedidos; ao fechar, limpam (nada escondido vai junto).
  function abrirTrechoImp(abrir) {
    $('trecho-imp').hidden = !abrir;
    $('btn-trecho').setAttribute('aria-expanded', abrir ? 'true' : 'false');
    if (abrir) $('imp-de').focus(); else { $('imp-de').value = ''; $('imp-ate').value = ''; }
  }
  $('btn-trecho').addEventListener('click', function () { abrirTrechoImp($('trecho-imp').hidden); });
  mascaraTC($('imp-de')); mascaraTC($('imp-ate'));
  $('form-link').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var campo = $('link'), btn = $('btn-importar'), msg = $('msg-link');
    var url = campo.value.trim();
    if (!url) { msg.textContent = 'Cole o link do vídeo.'; msg.className = 'ingest-msg erro'; campo.focus(); return; }
    var tr = $('trecho-imp').hidden ? { de: null, ate: null } : lerCamposTrecho($('imp-de'), $('imp-ate'));
    if (tr.erro) { msg.textContent = tr.erro; msg.className = 'ingest-msg erro'; $('imp-de').focus(); return; }
    btn.disabled = true; btn.textContent = 'Importando…';
    api('/videos', { metodo: 'POST', corpo: { url: url, analisar_de_s: tr.de, analisar_ate_s: tr.ate } }).then(function (r) {
      campo.value = ''; $('plat').dataset.p = ''; $('plat').textContent = 'LINK';
      abrirTrechoImp(false);
      msg.textContent = (r.ao_vivo_canal ? 'Live importada: o PC pega até o minuto em que buscar. ' : 'Importado. ') +
        (estado.pc.online ? 'O PC já vai buscar o texto.' : 'Quando o PC ligar, ele busca o texto.');
      msg.className = 'ingest-msg ok';
      selVideo = r.id;
      return carregar();
    }).catch(function (e) {
      msg.textContent = e.message; msg.className = 'ingest-msg erro';
      if (e.status === 409 && e.dados && e.dados.video_id) selecionar(e.dados.video_id);
    }).then(function () { btn.disabled = false; btn.textContent = 'Importar'; });
  });

  // ---------- quadro ----------
  function carregar() {
    return api('/quadro').then(function (j) {
      j.layouts = estado.layouts || [];      // os layouts vêm de /layouts, não do quadro
      estado = j; desenharPC(); desenharQuadro();
      if (selVideo) return carregarDetalhe(selVideo);
    }).catch(function (e) {
      if (!estado.videos.length && !estado.cortes.length) {
        ultimoQuadro = '';   // a próxima carga boa redesenha (a tela não fica presa no erro)
        quadroEl.innerHTML = '<div class="erro-carga"><p>' + esc(e.message) + '</p><button class="btn" type="button" id="tentar">Tentar de novo</button></div>';
        $('tentar').onclick = function () { quadroEl.innerHTML = '<p class="carregando">Carregando o quadro…</p>'; carregar(); };
      } else aviso(e.message, true);
    });
  }

  function desenharPC() {
    var el = $('pc'), pc = estado.pc || {};
    el.classList.toggle('online', pc.online > 0);
    el.querySelector('.pc-txt').textContent = !pc.total ? 'Conectar PC' : pc.online ? (pc.online === 1 ? pc.nomes_online[0] + ' online' : pc.online + ' PCs online') : 'PC offline';
    el.title = pc.total ? 'PCs conectados (toque para ver)' : 'Nenhum PC conectado ainda: toque para conectar';
  }
  $('pc').addEventListener('click', abrirPCs);

  // O que o PC está fazendo com este cartão, em uma linha.
  // 22/11: quantas tarefas o PC faz antes desta, na mesma ordem do servidor (maquina.js, PRIORIDADE):
  // legenda > roteiro > fotos > texto > download; empate pela ordem de chegada.
  var PRIO_FILA = { legenda: 0, roteiro: 1, quadros: 2, texto: 3, baixar_corte: 4 };
  function naFrente(x) {
    var fila = estado.fila || [];
    var t = fila.find(function (f) {
      return f.estado === 'pendente' && (x.corte_id ? f.corte_id === x.corte_id && f.tipo === 'baixar_corte'
        : f.video_id === x.id && (f.tipo === 'texto' || f.tipo === 'roteiro'));
    });
    if (!t) return '';
    var p = PRIO_FILA[t.tipo], antes = fila.filter(function (f) {
      var q = PRIO_FILA[f.tipo];
      return f.estado === 'pendente' && f.id !== t.id && (q < p || (q === p && f.id < t.id));
    });
    var baixando = fila.filter(function (f) { return f.estado === 'pega'; }).length;
    var n = antes.length;
    return n ? ' · ' + n + (n === 1 ? ' tarefa' : ' tarefas') + ' na frente' : baixando ? ' · é a próxima' : '';
  }
  function situacao(x, esperaTxt) {
    if (x.erro) return '<div class="c-estado falha"><span class="ponto"></span>' + esc(x.erro) + '</div>';
    if (x.tarefa_estado === 'pega') {
      // O PC manda sinal a cada 1 min enquanto trabalha (agente 1.4.0). Sem sinal há 3 min =
      // ele caiu (internet, PC desligado sem o atalho); a tarefa volta sozinha para a fila no prazo.
      var mudo = x.tarefa_atualizada ? Math.floor((Date.now() - Date.parse(x.tarefa_atualizada)) / 60000) : 0;
      if (mudo >= 3) return '<div class="c-estado falha"><span class="ponto"></span>' + esc((x.tarefa_pc ? x.tarefa_pc + ': ' : '') + 'sem notícia há ' + mudo + ' min (' + (x.tarefa_progresso || 'trabalhando') + ')') + '</div>';
      return '<div class="c-estado espera"><span class="ponto"></span>' + esc((x.tarefa_pc ? x.tarefa_pc + ': ' : '') + (x.tarefa_progresso || esperaTxt)) + '</div>';
    }
    if (x.tarefa_estado === 'pendente') {
      var pc = estado.pc || {};
      var txt = !pc.total ? 'Conecte um PC para começar' : !pc.online ? 'Esperando um PC ligar' : 'Na fila do PC' + naFrente(x);
      if (x.corte_fila && pc.total && !pc.baixam) txt = 'Nenhum PC recebe downloads (ver PCs)';
      return '<div class="c-estado espera"><span class="ponto"></span>' + txt + '</div>';
    }
    return '';
  }

  // 19/11 (pedido do dono): cortes em ordem de TEMPO dentro de cada vídeo (02:10:00 antes de
  // 02:30:00), e os vídeos na ordem do quadro (o mexido por último primeiro).
  function ordemCortes(a, b) {
    var ia = estado.videos.findIndex(function (v) { return v.id === a.video_id; }), ib = estado.videos.findIndex(function (v) { return v.id === b.video_id; });
    if (ia !== ib) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return a.inicio_s - b.inicio_s || a.id - b.id;
  }
  var ultimoQuadro = '';
  function desenharQuadro() {
    var rolagem = quadroEl.scrollLeft, html = '', atalhos = '';
    COLUNAS.forEach(function (col, i) {
      var itens = col.grupo === 'video'
        ? estado.videos.filter(function (v) { return v.etapa === col.id; })
        : estado.cortes.filter(function (c) { return c.estado === col.id; }).sort(ordemCortes);
      html += '<section class="coluna' + (i === 3 ? ' divisa' : '') + '" data-grupo="' + col.grupo + '" aria-label="' + esc(col.nome) + '">' +
        '<header class="col-topo"><span class="faixa">' + col.faixa + '</span><span class="col-nome">' + esc(col.nome) + '</span>' +
        '<span class="col-qtd">' + itens.length + '</span>' +
        // 23/11: voltar cortes para a Triagem em lote (refazer com as regras novas)
        ((col.id === 'download' || col.id === 'edicao') && itens.length ? '<button type="button" class="col-volta" data-voltar="1" title="Voltar cortes para a Triagem">↩ Triagem</button>' : '') +
        '</header><div class="col-lista">' +
        (itens.length ? itens.map(col.grupo === 'video' ? cartaoVideo : cartaoCorte).join('') : '<p class="col-vazia">' + esc(VAZIO[col.id]) + '</p>') +
        '</div></section>';
      atalhos += '<button type="button" data-col="' + i + '">' + col.faixa + ' ' + esc(col.nome.split(' ')[0]) + '<b>' + itens.length + '</b></button>';
    });
    // 19/11: a atualização a cada 20 s jogava a rolagem das colunas para o topo. Agora: nada mudou =
    // não redesenha; mudou = redesenha e devolve cada coluna (e a página) para onde estava.
    if (html !== ultimoQuadro) {
      var rolCols = Array.prototype.map.call(quadroEl.querySelectorAll('.col-lista'), function (el) { return el.scrollTop; });
      var rolPagina = window.scrollY;
      quadroEl.innerHTML = html;
      quadroEl.querySelectorAll('.col-lista').forEach(function (el, k) { if (rolCols[k]) el.scrollTop = rolCols[k]; });
      if (window.scrollY !== rolPagina) window.scrollTo(0, rolPagina);
      ultimoQuadro = html;
    }
    quadroEl.scrollLeft = rolagem;   // atualizar não pode jogar o celular de volta para a 1ª coluna
    $('atalhos').innerHTML = atalhos; marcarAtalho();
    var nv = estado.videos.length, nc = estado.cortes.length;
    $('resumo').textContent = nv + (nv === 1 ? ' vídeo' : ' vídeos') + ' · ' + nc + (nc === 1 ? ' corte' : ' cortes');
    // Vídeos com todos os cortes aprovados já publicados: hora de concluir (limpa o quadro e a linha do tempo).
    var prontos = estado.videos.filter(function (v) { var n = contagem(v.id); return v.etapa === 'cortado' && n.publicados && !n.abertos; });
    $('prontos').hidden = !prontos.length;
    $('prontos').innerHTML = prontos.map(function (v) {
      var n = contagem(v.id);
      return '<div class="pronto-item"><span class="pronto-txt"><b>✓ Tudo publicado</b> ' + esc(v.titulo || v.url) + ' · ' + n.publicados + ' corte(s)' + (n.triagem ? ', ' + n.triagem + ' sobrando na triagem' : '') + '</span>' +
        '<button class="btn btn-ok" type="button" data-concluir="' + v.id + '">Concluir vídeo</button></div>';
    }).join('');
  }

  function cartaoVideo(v) {
    // 18/11: live da Kick - o PC primeiro acha a live; "Puxar o resto" busca só a parte nova.
    var esperaEntrada = v.continuar_de_s != null ? 'puxando o resto…' : v.ao_vivo_canal && !v.capturado_ate_s ? 'procurando a live na Kick…' : 'buscando o texto…';
    var st = situacao(v, v.etapa === 'entrada' ? esperaEntrada : v.etapa === 'roteiro' ? 'IA começando a ler…' : 'transcrevendo…');
    if (!st && v.etapa === 'roteiro') st = '<div class="c-estado espera"><span class="ponto"></span>Texto pronto: aguardando a IA (etapa 3)</div>';
    return '<button type="button" class="cartao' + (v.id === selVideo ? ' sel' : '') + '" data-video="' + v.id + '">' +
      '<div class="c-linha"><span class="tag-plat ' + v.plataforma + '">' + PLAT[v.plataforma] + '</span>' +
      (v.ao_vivo ? '<span class="c-vivo" title="A live seguia no ar na última captura">● AO VIVO</span>' : '') +
      (v.duracao_s ? '<span class="c-tc">' + tc(v.duracao_s) + '</span>' : '') + '</div>' +
      '<p class="c-titulo">' + esc(v.titulo || v.url.replace(/^https:\/\/(www\.)?/, '')) + '</p>' +
      (v.canal ? '<div class="c-sub">' + esc(v.canal) + '</div>' : '') +
      (v.ao_vivo_canal && v.capturado_ate_s ? '<div class="c-trecho" title="Até onde o texto foi capturado">⟳ capturado até ' + tc(v.capturado_ate_s) + '</div>'
        : !v.ao_vivo_canal && podePuxar(v) ? '<div class="c-trecho" title="Analisado só até aqui: use Puxar mais">⟳ analisado até ' + tc(capturado(v)) + ' de ' + tc(v.duracao_s) + '</div>' : '') +
      (textoTrecho(v) ? '<div class="c-trecho" title="Parte do vídeo analisada">⏱ ' + textoTrecho(v) + '</div>' : '') + st + '</button>';
  }

  // 21/11 (pedido do dono): categoria principal do corte (etiqueta no cartão) e a leitura da IA
  // com os critérios na gaveta. Corte antigo, sem categoria, não ganha etiqueta.
  var CATS = {
    hype: 'HYPE', engracado: 'ENGRAÇADO', epico: 'ÉPICO', curiosidade: 'CURIOSIDADE', reacao: 'REAÇÃO',
    polemica: 'POLÊMICA', historia: 'HISTÓRIA', bastidores: 'BASTIDORES', outro: 'A DEFINIR',
  };
  var CRITERIOS = [
    ['forca', 'Força do acontecimento', 20], ['retencao', 'Retenção', 15], ['desfecho', 'Desfecho', 15], ['autonomia', 'Funciona sozinho', 15],
    ['contexto', 'Contexto', 10], ['desenvolvimento', 'Desenvolvimento', 10], ['compartilhamento', 'Compartilhamento', 10], ['diferencial', 'Diferencial na live', 5],
  ];
  var NOTA_FRACA = 45;   // abaixo disso a nota fica vermelha (decisão do dono, 21/11: só marcar, não descartar)
  function etiquetaCat(cat) {
    return cat && CATS[cat] ? '<span class="cat cat-' + cat + '">' + CATS[cat] + '</span>' : '';
  }
  function caixaIA(c) {
    var cr = null; try { cr = c.criterios ? JSON.parse(c.criterios) : null; } catch (e) { cr = null; }
    var cab = '<b>LEITURA DA IA' + (c.nota != null ? ' · POTENCIAL ' + c.nota + '/100' : '') + '</b>';
    var cat = c.categoria
      ? '<div class="ia-cat">' + etiquetaCat(c.categoria) +
        '<select id="c-cat" aria-label="Categoria do corte">' + Object.keys(CATS).map(function (k) {
          return '<option value="' + k + '"' + (k === c.categoria ? ' selected' : '') + '>' + CATS[k] + '</option>'; }).join('') + '</select></div>' +
        (c.categoria_porque ? '<p class="ia-linha"><span>Por quê</span>' + esc(c.categoria_porque) + '</p>' : '') +
        (c.acontecimento ? '<p class="ia-linha"><span>Acontecimento</span>' + esc(c.acontecimento) + '</p>' : '')
      : '';
    var motivo = c.motivo ? '<p class="ia-linha"><span>Gancho</span>' + esc(c.motivo) + '</p>' : '';
    var lim = c.limitacao ? '<p class="ia-lim">⚠ Só pelo texto não dá para avaliar: ' + esc(c.limitacao) + '</p>' : '';
    var barras = cr ? '<details class="ia-crit"><summary>Como a nota foi calculada</summary>' +
        CRITERIOS.map(function (k) {
          var v = Math.max(0, Math.min(10, Number(cr[k[0]]) || 0));
          return '<div class="crit"><span>' + k[1] + ' <small>' + k[2] + '%</small></span><i><em style="width:' + (v * 10) + '%"></em></i><b>' + v + '</b></div>';
        }).join('') +
        '<p class="ia-nota">A IA dá de 0 a 10 em cada critério lendo o texto da live; a nota é a média com esses pesos, vezes 10. É um potencial estimado, não uma previsão de visualizações.' +
        (c.nota_antiga != null ? ' Nota antiga, antes da classificação: ' + c.nota_antiga + '.' : '') + '</p></details>' : '';
    var botao = '<div class="ia-acoes"><button type="button" class="mini" id="c-classificar">' + (cr ? '↻ Reclassificar' : '🏷 Classificar com a IA') + '</button>' +
      (cr ? '' : '<small>Dá categoria, critérios e nota a este corte. Não muda título, tempo nem arquivo.</small>') + '</div>';
    return '<div class="caixa-ia" id="caixa-ia">' + cab + cat + motivo + lim + barras + botao + '</div>';
  }
  function ligarCaixaIA(box, c) {
    var area = box.querySelector('#caixa-ia'); if (!area) return;
    function atualizarQuadro() {
      var q = estado.cortes.find(function (x) { return x.id === c.id; });
      if (q) { q.categoria = c.categoria; q.nota = c.nota; desenharQuadro(); }
    }
    var sel = area.querySelector('#c-cat');
    if (sel) sel.onchange = function () {
      var antes = c.categoria, nova = sel.value;
      sel.disabled = true;
      api('/cortes/' + c.id, { metodo: 'PATCH', corpo: { categoria: nova } }).then(function () {
        c.categoria = nova; area.outerHTML = caixaIA(c); ligarCaixaIA(box, c); atualizarQuadro();
        aviso('Categoria trocada para ' + CATS[nova] + '.');
      }).catch(function (e) { sel.value = antes; sel.disabled = false; aviso(e.message, true); });
    };
    var bt = area.querySelector('#c-classificar');
    bt.onclick = function () {
      bt.disabled = true; bt.textContent = '🏷 A IA está lendo o corte…';
      api('/cortes/' + c.id + '/classificar', { metodo: 'POST' }).then(function (r) {
        if (!c.criterios && c.nota_antiga == null) c.nota_antiga = c.nota;
        ['categoria', 'categoria_porque', 'acontecimento', 'criterios', 'limitacao', 'nota'].forEach(function (k) { c[k] = r[k]; });
        area.outerHTML = caixaIA(c); ligarCaixaIA(box, c); atualizarQuadro();
        aviso('Corte classificado: ' + (CATS[r.categoria] || r.categoria) + ', potencial ' + r.nota + '/100.');
      }).catch(function (e) { bt.disabled = false; bt.textContent = c.criterios ? '↻ Reclassificar' : '🏷 Classificar com a IA'; aviso(e.message, true); });
    };
  }

  function cartaoCorte(c) {
    var acoes = '';
    if (c.estado === 'triagem') acoes = '<button type="button" class="mini sim" data-acao="download" data-corte="' + c.id + '">✓ Aprovar</button>' +
      (c.tipo === 'longo' ? '<button type="button" class="mini fora" data-acao="edicao" data-corte="' + c.id + '" title="Aprova sem o PC baixar: você baixa por fora com o tempo">↗ Sem baixar</button>' : '') +
      '<button type="button" class="mini nao" data-acao="descartado" data-corte="' + c.id + '">✕ Descartar</button>';
    else if (c.estado === 'download' && c.erro) acoes = '<button type="button" class="mini sim" data-tentar-corte="' + c.id + '">↻ Tentar de novo</button><button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'download' && c.tarefa_estado !== 'pega') acoes = '<button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'edicao') acoes = '<button type="button" class="mini sim" data-acao="publicado" data-corte="' + c.id + '">✓ Publicado</button>';
    var st = c.estado === 'download' || c.erro ? situacao({ erro: c.erro, tarefa_estado: c.tarefa_estado, tarefa_pc: c.tarefa_pc, tarefa_progresso: c.tarefa_progresso, tarefa_atualizada: c.tarefa_atualizada, corte_fila: true, corte_id: c.id }, 'baixando…') : '';
    return '<div role="button" tabindex="0" class="cartao ' + c.tipo + '" data-corte-abrir="' + c.id + '">' +
      '<div class="c-linha"><span class="tipo ' + c.tipo + '">' + (c.tipo === 'longo' ? 'LONGO' : 'CURTO') + '</span>' +
      '<span class="c-tc">' + tc(c.inicio_s) + '</span><span>' + duracao(c.fim_s - c.inicio_s) + '</span>' +
      (c.categoria || c.nota != null ? '<span class="c-ia">' + etiquetaCat(c.categoria) +
        (c.nota != null ? '<span class="nota' + (c.nota < NOTA_FRACA ? ' fraca' : '') + '" title="Potencial estimado pela leitura do texto (0-100). Não é previsão de views.">' + c.nota + '</span>' : '') + '</span>' : '') + '</div>' +
      '<p class="c-titulo">' + esc(c.titulo) + '</p>' +
      // 23/11: curto que demora a chegar no gancho (no Shorts a pessoa decide em 2 s)
      (c.tipo === 'curto' && c.gancho_inicio_s != null && c.gancho_inicio_s - c.inicio_s > 3 && ['triagem', 'edicao'].includes(c.estado)
        ? '<div class="c-frio" title="Abra o corte e use Começar no gancho">⚠ começa frio · gancho aos ' + Math.round(c.gancho_inicio_s - c.inicio_s) + ' s</div>' : '') +
      '<div class="c-sub">' + esc(c.video_titulo || NOME_PLAT[c.plataforma]) + '</div>' +
      (c.baixar_fora && c.estado === 'edicao' ? '<div class="c-fora">↗ BAIXAR FORA · ' + tc(c.inicio_s) + ' → ' + tc(c.fim_s) + '</div>' : '') +
      (layoutEfetivo(c, c.video_layout_id) && nomeLayout(layoutEfetivo(c, c.video_layout_id)) && !c.baixar_fora
        ? '<div class="c-layout" title="Vertical 9:16 gerado no PC com este layout">▦ ' + esc(nomeLayout(layoutEfetivo(c, c.video_layout_id))) +
          (c.cena_auto && c.estado === 'triagem' ? ' <span class="c-auto" title="Escolhido pela cena que a IA viu na foto">· auto</span>' : '') +
          (c.legenda_editada ? ' <span class="c-auto" title="Legenda revisada no painel">· legenda ✓</span>' : '') + '</div>'
        // 19/11: curto sem layout sai só horizontal (sem vertical e sem legenda no vídeo): avisa antes de aprovar
        : c.tipo === 'curto' && !c.baixar_fora && c.estado !== 'publicado'
          ? '<div class="c-layout sem" title="Abra o corte e escolha um layout para o PC gerar o vertical legendado">▭ só horizontal · sem layout</div>' : '') +
      (c.qualidade ? '<div class="c-qual" title="' + esc(c.qualidade) + '">▣ ' + esc(c.qualidade.split(' · ').slice(0, 2).join(' · ')) +
        (/· legendado/.test(c.qualidade) ? ' · legendado' : /legenda FALHOU/.test(c.qualidade) ? ' · <span style="color:var(--perigo)">sem legenda</span>' : '') + '</div>' : '') + st +
      (acoes ? '<div class="c-acoes">' + acoes + '</div>' : '') + '</div>';
  }

  quadroEl.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-voltar]')) { ev.stopPropagation(); abrirVoltar(); return; }
    var tn = ev.target.closest('[data-tentar-corte]');
    if (tn) { ev.stopPropagation(); tentar('cortes', Number(tn.dataset.tentarCorte), tn); return; }
    var b = ev.target.closest('[data-acao]');
    if (b) { ev.stopPropagation(); mudarEstado(Number(b.dataset.corte), b.dataset.acao, b); return; }
    var v = ev.target.closest('[data-video]');
    if (v) { selecionar(Number(v.dataset.video)); abrirVideo(); return; }
    var c = ev.target.closest('[data-corte-abrir]');
    if (c) abrirCorte(Number(c.dataset.corteAbrir), true);
  });
  // 23/11 (pedido do dono): voltar cortes do Download e da Edição para a Triagem, escolhendo por
  // canal, para refazer aos poucos com as regras novas. Só grava ao confirmar.
  function abrirVoltar() {
    var lista = estado.cortes.filter(function (c) { return c.estado === 'download' || c.estado === 'edicao'; });
    var grupos = {};
    lista.forEach(function (c) { var k = c.video_canal || c.video_titulo || 'sem canal'; (grupos[k] = grupos[k] || []).push(c); });
    var nomes = Object.keys(grupos).sort(function (a, b) { return grupos[b].length - grupos[a].length; });
    var html = '<p class="volta-txt">Os cortes marcados voltam para a <b>Triagem</b> com título, textos e legenda. O arquivo que o PC já baixou continua na pasta; ao aprovar de novo, o PC baixa a versão nova (apague a antiga no PC se o nome mudar).</p>' +
      nomes.map(function (n, g) {
        return '<div class="volta-grupo"><label class="volta-canal"><input type="checkbox" data-grupo-todo="' + g + '"> <b>' + esc(n) + '</b> <span>' + grupos[n].length + ' corte(s)</span></label>' +
          grupos[n].map(function (c) {
            return '<label class="volta-item"><input type="checkbox" data-g="' + g + '" value="' + c.id + '"> <span class="tipo ' + c.tipo + '">' + (c.tipo === 'longo' ? 'L' : 'C') + '</span> ' +
              esc(c.titulo) + ' <small>' + (c.estado === 'download' ? 'download' : 'edição') + '</small></label>';
          }).join('') + '</div>';
      }).join('') +
      '<p class="msg-form" id="volta-msg"></p><div class="acoes"><button class="btn btn-cor" type="button" id="volta-ok" disabled>Voltar para a Triagem</button>' +
      '<button class="btn btn-fino" type="button" id="volta-cancelar">Cancelar</button></div>';
    abrirGaveta('Voltar para a Triagem', html, function (box) {
      var ok = box.querySelector('#volta-ok');
      function marcados() { return Array.prototype.filter.call(box.querySelectorAll('input[data-g]'), function (i) { return i.checked; }); }
      function contar() {
        var n = marcados().length; ok.disabled = !n; ok.textContent = n ? 'Voltar ' + n + ' para a Triagem' : 'Voltar para a Triagem';
        box.querySelectorAll('[data-grupo-todo]').forEach(function (t) {
          var itens = box.querySelectorAll('input[data-g="' + t.dataset.grupoTodo + '"]'), m = Array.prototype.filter.call(itens, function (i) { return i.checked; }).length;
          t.checked = m === itens.length; t.indeterminate = m > 0 && m < itens.length;
        });
      }
      box.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t.dataset.grupoTodo != null) box.querySelectorAll('input[data-g="' + t.dataset.grupoTodo + '"]').forEach(function (i) { i.checked = t.checked; });
        contar();
      });
      box.querySelector('#volta-cancelar').onclick = fecharGaveta;
      ok.onclick = function () {
        var ids = marcados().map(function (i) { return Number(i.value); });
        confirmar('Voltar ' + ids.length + ' corte(s) para a Triagem? Para baixar de novo, aprove cada um quando estiver pronto.', 'Voltar').then(function (sim) {
          if (!sim) return;
          ok.disabled = true; ok.textContent = 'Voltando…';
          api('/cortes/voltar-triagem', { metodo: 'POST', corpo: { ids: ids } }).then(function (r) {
            fecharGaveta(); return carregar().then(function () {
              if (r.ficaram) alertaQuadro(r.voltaram + ' voltaram para a Triagem; ' + r.ficaram + (r.ficaram === 1 ? ' ficou' : ' ficaram') + ' porque o PC estava baixando.');
            });
          }).catch(function (e) { var m = box.querySelector('#volta-msg'); m.textContent = e.message; m.className = 'msg-form erro'; contar(); });
        });
      };
    });
  }
  function alertaQuadro(txt) { var m = $('msg-link'); if (m) { m.textContent = txt; m.className = 'ingest-msg ok'; } }
  // Celular: uma coluna por vez; os atalhos levam direto a ela.
  function marcarAtalho() {
    var col = quadroEl.querySelector('.coluna'); if (!col) return;
    var i = Math.round(quadroEl.scrollLeft / (col.offsetWidth + 6));
    $('atalhos').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.col) === i); });
  }
  quadroEl.addEventListener('scroll', function () { clearTimeout(marcarAtalho.t); marcarAtalho.t = setTimeout(marcarAtalho, 80); }, { passive: true });
  $('atalhos').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-col]'); if (!b) return;
    var col = quadroEl.querySelectorAll('.coluna')[Number(b.dataset.col)];
    if (col) quadroEl.scrollTo({ left: col.offsetLeft - 6, behavior: 'smooth' });
  });
  quadroEl.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-corte-abrir]')) { ev.preventDefault(); abrirCorte(Number(ev.target.dataset.corteAbrir), true); }
  });

  function tentar(tipo, id, botao) {
    if (botao) botao.disabled = true;
    return api('/' + tipo + '/' + id + '/tentar', { metodo: 'POST' }).then(function () { aviso('Voltou para a fila do PC.'); return carregar(); })
      .catch(function (e) { aviso(e.message, true); if (botao) botao.disabled = false; });
  }

  // extra: campos editados na gaveta (tempo, título...) que vão JUNTO com a mudança de estado.
  // 15/11: "Aprovar e baixar" mandava só o estado e o tempo editado sem "Salvar" se perdia.
  // Resolve true se deu certo, false se falhou (o aviso já mostrou o motivo).
  function mudarEstado(id, novo, botao, extra) {
    if (botao) botao.disabled = true;
    var corpo = Object.assign({}, extra || {}, { estado: novo });
    var antes = (estado.cortes.find(function (c) { return c.id === id; }) || {}).estado;
    return api('/cortes/' + id, { metodo: 'PATCH', corpo: corpo }).then(function () {
      aviso(novo === 'edicao' && antes === 'triagem' ? 'Aprovado sem baixar: o tempo está na C3 Edição e a ficha .txt vai para a pasta dos cortes no PC.'
        : ({ download: 'Aprovado: foi para a fila do PC.', descartado: 'Descartado.', triagem: 'Voltou para a triagem.', publicado: 'Marcado como publicado.', edicao: 'Voltou para a edição.' }[novo] || 'Feito.'));
      carregar();
      return true;
    }).catch(function (e) { aviso(e.message, true); if (botao) botao.disabled = false; return false; });
  }

  // ---------- concluir vídeo (15/11: "resetar a linha do tempo" quando tudo foi publicado) ----------
  // Concluir = arquivar: o vídeo e os cortes saem do quadro e da linha do tempo, nada é apagado,
  // e dá para reabrir em "Concluídos".
  function contagem(videoId) {
    var r = { publicados: 0, abertos: 0, triagem: 0, fila: 0 };
    estado.cortes.forEach(function (c) {
      if (c.video_id !== videoId) return;
      if (c.estado === 'publicado') r.publicados++;
      else if (c.estado === 'triagem') r.triagem++;
      else if (c.estado === 'download' || c.estado === 'edicao') { r.abertos++; if (c.estado === 'download') r.fila++; }
    });
    return r;
  }
  function concluirVideo(v) {
    var n = contagem(v.id), txt;
    if (n.fila) { aviso('Tem ' + n.fila + ' corte(s) na fila do PC. Espere baixar ou cancele antes de concluir.', true); return; }
    if (n.abertos) txt = 'Ainda tem ' + n.abertos + ' corte(s) aprovado(s) sem publicar na Edição. Concluir mesmo assim? Eles saem do quadro junto (nada é apagado).';
    else if (n.triagem) txt = 'Tudo o que foi aprovado está publicado. Os ' + n.triagem + ' corte(s) que ficaram na triagem saem junto. Concluir o vídeo?';
    else txt = 'Concluir este vídeo? Ele e os cortes saem do quadro e da linha do tempo. Fica tudo guardado em "Concluídos", dá para reabrir.';
    confirmar(txt, 'Concluir').then(function (sim) {
      if (!sim) return;
      api('/videos/' + v.id, { metodo: 'PATCH', corpo: { arquivado: true } }).then(function () {
        aviso('Vídeo concluído: está em "Concluídos".'); fecharGaveta(); selVideo = null; detalhe = null; desenharLinha(); carregar();
      }).catch(function (e) { aviso(e.message, true); });
    });
  }
  $('btn-concluir').addEventListener('click', function () { if (detalhe) concluirVideo(detalhe.video); });
  $('linha-nome').addEventListener('click', function () { if (detalhe) abrirVideo(); });
  // ---------- "Puxar o resto" (18/11): live da Kick, só a parte nova ----------
  // Até onde o texto do vídeo já foi buscado (live: a captura; vídeo gravado: o "até" do trecho).
  function capturado(v) { return v.capturado_ate_s || v.analisar_ate_s || null; }
  function podePuxar(v) {
    // só com o roteiro pronto: com a IA parada no meio, a parte já capturada ficaria sem leitura
    if (!(v && v.continuar_de_s == null && v.etapa === 'cortado' && capturado(v))) return false;
    // 19/11: também vídeo GRAVADO analisado só em parte (live de 10 h: pega 2 h, depois mais 2 h...)
    if (v.ao_vivo_canal) return true;
    return !!(v.duracao_s && capturado(v) < v.duracao_s - 60);
  }
  function puxarResto(v, botao, msgEl, ate) {
    botao.disabled = true;
    return api('/videos/' + v.id + '/continuar', { metodo: 'POST', corpo: { ate_s: ate == null ? null : ate } }).then(function (r) {
      var ate2 = r.ate != null ? ' até ' + tc(r.ate) : ' até o fim';
      aviso(estado.pc.online ? 'Puxando' + ate2 + ': o PC já vai buscar a parte nova.' : 'Na fila (' + ate2.trim() + '): quando o PC ligar, ele busca a parte nova.');
      fecharGaveta(); detalhe = null; carregar().then(function () { if (selVideo) carregarDetalhe(selVideo); });
    }).catch(function (e) { botao.disabled = false; if (msgEl) msgEl.textContent = e.message; else aviso(e.message, true); });
  }
  $('btn-resto').addEventListener('click', function () {
    if (!detalhe) return;
    abrirVideo(function (box) { var a = box.querySelector('#resto-ate'); if (a) { a.scrollIntoView({ block: 'center' }); a.focus(); } });
  });
  function abrirConcluidos() {
    api('/concluidos').then(function (j) {
      var lista = j.videos || [];
      abrirGaveta('Vídeos concluídos',
        (lista.length ? '<ul class="lista-conc">' + lista.map(function (v) {
          return '<li><div><span class="tag-plat ' + v.plataforma + '">' + PLAT[v.plataforma] + '</span> <b>' + esc(v.titulo || v.url) + '</b>' +
            '<small>' + v.publicados + ' publicado(s) de ' + v.cortes + ' corte(s) · concluído em ' + data(v.atualizado_em) + '</small></div>' +
            '<button class="btn btn-fino" type="button" data-reabrir="' + v.id + '">Reabrir</button></li>';
        }).join('') + '</ul>' : '<p style="color:var(--suave);margin:0">Nenhum vídeo concluído ainda. Quando todos os cortes aprovados de um vídeo estiverem publicados, use <b>Concluir vídeo</b> na linha do tempo.</p>') +
        '<div class="acoes"><button class="btn btn-fino" type="button" id="conc-fechar">Fechar</button></div>',
        function (box) {
          box.querySelector('#conc-fechar').onclick = fecharGaveta;
          box.querySelectorAll('[data-reabrir]').forEach(function (b) {
            b.onclick = function () {
              b.disabled = true;
              api('/videos/' + b.dataset.reabrir, { metodo: 'PATCH', corpo: { arquivado: false } }).then(function () {
                aviso('Reaberto: voltou para o quadro.'); abrirConcluidos(); carregar();
              }).catch(function (e) { aviso(e.message, true); b.disabled = false; });
            };
          });
        });
    }).catch(function (e) { aviso(e.message, true); });
  }
  $('btn-concluidos').addEventListener('click', abrirConcluidos);
  // ---------- layouts verticais dos curtos (19/11) ----------
  function nomeLayout(id) { var l = estado.layouts.find(function (x) { return x.id === id; }); return l ? l.nome : null; }
  // layout que vale para o corte curto: o dele; senão o do vídeo; 0 = nenhum
  function layoutEfetivo(c, videoLayout) {
    if (c.tipo !== 'curto') return null;
    var id = c.layout_id != null ? c.layout_id : videoLayout;
    return id ? id : null;
  }
  function opcoesLayout(valor, rotuloVazio) {
    return '<option value=""' + (valor == null ? ' selected' : '') + '>' + esc(rotuloVazio) + '</option>' +
      estado.layouts.map(function (l) { return '<option value="' + l.id + '"' + (valor === l.id ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; }).join('') +
      '<option value="0"' + (valor === 0 ? ' selected' : '') + '>Nenhum (só o horizontal)</option>';
  }
  // ---------- foto e cena do corte curto (19/11) ----------
  var CENAS = { fullcam: 'Full cam', jogo_webcam: 'Jogo com webcam', jogo: 'Só o jogo' };
  function blocoCena(c) {
    if (c.tipo !== 'curto') return '<div id="cena-vazia"></div>';
    var podeRefazer = c.estado === 'triagem';
    var txt = c.cena ? 'IA: <b>' + CENAS[c.cena] + '</b>' + (c.cena_conf != null ? ' (' + c.cena_conf + '%)' : '') +
        (c.cena_auto && c.estado === 'triagem' ? ' · layout escolhido pela cena' : '') : '';
    var quando = c.quadro_s != null ? 'Foto em ' + tc(c.quadro_s) : '';
    var corpo;
    if (c.quadro_chave) {
      corpo = '<div class="cena-fotos" id="cena-img"><div class="cena-quadro"><img id="cena-foto" alt="Foto do corte" src="' + API + '/quadros/' + c.id + '?v=' + encodeURIComponent(c.quadro_em || '') + '">' +
        '<div class="cena-caixa jogo" id="cena-jogo"><span>GAMEPLAY</span></div><div class="cena-caixa cam" id="cena-cam"><span>WEBCAM</span></div></div>' +
        '<canvas class="cena-previa" id="cena-previa" width="135" height="240" title="Como fica o vertical"></canvas></div>';
    } else if (c.quadro_em) {
      corpo = '<p class="cena-msg">Sem foto guardada (o depósito de arquivos ainda não está ligado), mas a IA já viu a cena.</p>';
    } else {
      corpo = '<p class="cena-msg">' + (c.estado === 'triagem' ? 'A foto ainda não chegou: o PC tira depois do roteiro (programa 2.1.0 ou mais novo).' : 'Sem foto (a foto é tirada enquanto o corte está na Triagem).') + '</p>';
    }
    return '<div class="cena">' + corpo +
      ((txt || quando || podeRefazer) ? '<div class="cena-linha"><span>' + [quando, txt].filter(Boolean).join(' · ') + '</span>' +
        (podeRefazer ? '<button type="button" class="mini" id="c-foto">📷 Tirar foto de novo</button>' : '') + '</div>' : '') + '</div>';
  }
  function desenharCena(box, L) {
    var img = box.querySelector('#cena-foto'); if (!img) return;
    var j = box.querySelector('#cena-jogo'), cam = box.querySelector('#cena-cam'), cv = box.querySelector('#cena-previa');
    function pos(el, x, y, w, h) { el.hidden = false; el.style.left = x * 100 + '%'; el.style.top = y * 100 + '%'; el.style.width = w * 100 + '%'; el.style.height = h * 100 + '%'; }
    j.hidden = cam.hidden = true;
    var g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 135, 240);
    if (!L) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('sem vertical', 67, 124); return; }
    pos(j, L.jogo_x, L.jogo_y, L.jogo_w, L.jogo_h);
    j.querySelector('span').textContent = L.tipo === 'webcam' ? 'GAMEPLAY' : 'RECORTE';
    if (L.tipo === 'webcam') pos(cam, L.cam_x, L.cam_y, L.cam_w, L.cam_h);
    if (!img.naturalWidth) return;
    var W = img.naturalWidth, H = img.naturalHeight;
    var hc = L.tipo === 'webcam' ? Math.round((1920 * (L.cam_altura || 0.35)) / 2) * 2 / 8 : 0;   // 1080x1920 / 8
    if (L.tipo === 'webcam') g.drawImage(img, L.cam_x * W, L.cam_y * H, L.cam_w * W, L.cam_h * H, 0, 0, 135, hc);
    g.drawImage(img, L.jogo_x * W, L.jogo_y * H, L.jogo_w * W, L.jogo_h * H, 0, hc, 135, 240 - hc);
  }

  if (window.CortexLayouts) {
    CortexLayouts.iniciar({ api: api, aviso: aviso, confirmar: confirmar, esc: esc,
      aoMudar: function (l) { estado.layouts = l; desenharQuadro(); } });
    CortexLayouts.carregar().then(function (l) { estado.layouts = l; desenharQuadro(); }).catch(function () { /* a tela segue sem os nomes */ });
    $('btn-layouts').addEventListener('click', function () { CortexLayouts.abrir(); });
  }
  $('prontos').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-concluir]'); if (!b) return;
    var v = estado.videos.find(function (x) { return x.id === Number(b.dataset.concluir); });
    if (v) concluirVideo(v);
  });

  // ---------- linha do tempo ----------
  function selecionar(id) {
    selVideo = id;
    document.querySelectorAll('.cartao.sel').forEach(function (el) { el.classList.remove('sel'); });
    var el = quadroEl.querySelector('[data-video="' + id + '"]');
    if (el) el.classList.add('sel');
    return carregarDetalhe(id);
  }
  function carregarDetalhe(id) {
    return api('/videos/' + id).then(function (j) {
      if (selVideo !== id) return;
      detalhe = j; desenharLinha();
    }).catch(function (e) {
      if (e.status === 404) { selVideo = null; detalhe = null; desenharLinha(); } else aviso(e.message, true);
    });
  }

  function escala(total) {
    // passo da régua: o menor que deixa ~8-14 marcas
    var opcoes = [10, 30, 60, 120, 300, 600, 900, 1800, 3600];
    for (var i = 0; i < opcoes.length; i++) if (total / opcoes[i] <= 14) return opcoes[i];
    return 7200;
  }

  function desenharLinha() {
    var corpo = $('linha-corpo'), nome = $('linha-nome'), btn = $('btn-marcar');
    if (!detalhe) {
      nome.textContent = 'Nenhum vídeo selecionado'; nome.disabled = true; btn.hidden = true; $('btn-concluir').hidden = true; $('btn-resto').hidden = true;
      corpo.innerHTML = '<p class="linha-vazia">Toque num vídeo do quadro para ver os cortes dele aqui.</p>';
      return;
    }
    var v = detalhe.video, cortes = detalhe.cortes;
    nome.textContent = (v.titulo || v.url) + (v.duracao_s ? '  ·  ' + tc(v.duracao_s) : '');
    nome.title = 'Abrir os detalhes do vídeo: ' + nome.textContent;
    nome.disabled = false;
    $('btn-resto').hidden = !podePuxar(v);
    if (podePuxar(v)) $('btn-resto').textContent = '⟳ Puxar mais (de ' + tc(capturado(v)) + ')';
    btn.hidden = false;
    var cont = contagem(v.id), bc = $('btn-concluir');
    bc.hidden = v.etapa !== 'cortado';
    bc.classList.toggle('btn-ok', !!cont.publicados && !cont.abertos);
    bc.textContent = cont.publicados && !cont.abertos ? '✓ Concluir vídeo (tudo publicado)' : 'Concluir vídeo';
    var fimMax = cortes.reduce(function (m, c) { return Math.max(m, c.fim_s); }, 0);
    var total = v.duracao_s || Math.max(3600, Math.ceil(fimMax * 1.1 / 600) * 600);
    var passo = escala(total), marcas = '';
    for (var t = 0; t <= total; t += passo) {
      var x = (t / total * 100).toFixed(3);
      marcas += '<i style="left:' + x + '%"></i>' + (t < total ? '<span style="left:' + x + '%">' + tc(t) + '</span>' : '');
    }
    var passoPct = 'calc(100% * ' + (passo / total).toFixed(5) + ')';
    function pista(tipo) {
      return '<div class="pista" style="--passo:' + passoPct + '">' + cortes.filter(function (c) { return c.tipo === tipo; }).map(function (c) {
        var l = c.inicio_s / total * 100, w = (c.fim_s - c.inicio_s) / total * 100;
        return '<button type="button" class="clipe ' + tipo + (c.estado === 'descartado' ? ' descartado' : '') + '" data-clipe="' + c.id + '" style="left:' + l.toFixed(3) + '%;width:' + w.toFixed(3) + '%" title="' + esc(tc(c.inicio_s) + ' → ' + tc(c.fim_s) + ' · ' + c.titulo) + '">' + esc(c.titulo) + '</button>';
      }).join('') + '</div>';
    }
    var obs = !v.duracao_s ? '<span>Duração ainda desconhecida: o PC informa ao buscar o vídeo.</span>' : '';
    if (textoTrecho(v)) obs += '<span><b class="leg-fora"></b>Fora da análise (' + textoTrecho(v) + ')</span>';
    corpo.innerHTML =
      '<div class="tl"><div class="tl-cab"><div class="r">TC</div><div class="l">L</div><div class="c">C</div></div>' +
      '<div class="tl-area">' + foraDoTrecho(v, total) + '<div class="regua" style="--passo:' + passoPct + '">' + marcas + '</div>' +
      pista('longo') + pista('curto') + '<span class="cabeca" id="cabeca"></span></div></div>' +
      '<div class="tl-legenda"><span><b style="background:var(--longo)"></b>Longo (30-40 min)</span><span><b style="background:var(--curto)"></b>Curto (45-90 s)</span>' +
      '<span><b style="background:var(--fio-2)"></b>Descartado (apagado)</span>' + obs +
      (cortes.length ? '' : '<span>Sem cortes ainda.</span>') + '</div>';
    var area = corpo.querySelector('.tl-area'), cab = $('cabeca');
    area.addEventListener('pointermove', function (ev) {
      var r = area.getBoundingClientRect(), p = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      cab.style.left = (p * 100) + '%'; cab.title = tc(p * total);
    });
    area.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-clipe]');
      if (b) abrirCorte(Number(b.dataset.clipe), false);
    });
  }
  $('btn-marcar').addEventListener('click', function () { if (detalhe) formCorte(null); });
  // Faixas listradas = parte do vídeo que ficou de fora da análise (antes do "de", depois do "até").
  function foraDoTrecho(v, total) {
    var h = '';
    if (v.analisar_de_s) h += '<span class="tl-fora" style="left:0;width:' + Math.min(100, v.analisar_de_s / total * 100).toFixed(3) + '%"></span>';
    if (v.analisar_ate_s && v.analisar_ate_s < total) {
      var l = v.analisar_ate_s / total * 100;
      h += '<span class="tl-fora" style="left:' + l.toFixed(3) + '%;width:' + (100 - l).toFixed(3) + '%"></span>';
    }
    return h;
  }

  // ---------- gaveta ----------
  function abrirGaveta(titulo, html, aoMontar) {
    $('gaveta-titulo').textContent = titulo;
    $('gaveta-corpo').innerHTML = html;
    $('gaveta').hidden = false; $('veu').hidden = false;
    document.body.style.overflow = 'hidden';
    if (aoMontar) aoMontar($('gaveta-corpo'));
    var f = $('gaveta-corpo').querySelector('input, textarea, button'); if (f && matchMedia('(min-width: 721px)').matches) f.focus();
  }
  function fecharGaveta() {
    $('gaveta').hidden = true; $('veu').hidden = true; document.body.style.overflow = '';
  }
  $('gaveta-fechar').onclick = fecharGaveta;
  $('veu').onclick = fecharGaveta;
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!$('modal').hidden) { $('modal-nao').click(); return; }
    if (!$('gaveta').hidden) fecharGaveta();
  });

  function confirmar(txt, rotulo) {
    return new Promise(function (ok) {
      $('modal-txt').textContent = txt; $('modal-sim').textContent = rotulo || 'Excluir';
      $('modal').hidden = false; $('modal-nao').focus();
      function fim(v) { $('modal').hidden = true; $('modal-sim').onclick = $('modal-nao').onclick = null; ok(v); }
      $('modal-sim').onclick = function () { fim(true); };
      $('modal-nao').onclick = function () { fim(false); };
    });
  }

  function abrirVideo(depois) {   // depois(box): chamado com a gaveta montada (ex.: focar o "Puxar mais")
    var base = estado.videos.find(function (v) { return v.id === selVideo; });
    var pronto = detalhe && detalhe.video.id === selVideo ? Promise.resolve() : carregarDetalhe(selVideo);
    pronto.then(function () {
      var v = detalhe ? detalhe.video : base;
      if (!v) return;
      var etapas = { entrada: 'Entrada (esperando o PC)', transcricao: 'Transcrevendo', roteiro: 'Roteiro com a IA', cortado: 'Cortado' };
      abrirGaveta(v.titulo || 'Vídeo sem título',
        '<dl class="info"><dt>Origem</dt><dd><span class="tag-plat ' + v.plataforma + '">' + PLAT[v.plataforma] + '</span> ' + NOME_PLAT[v.plataforma] + '</dd>' +
        '<dt>Link</dt><dd><a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + esc(v.url) + '</a></dd>' +
        (v.canal ? '<dt>Canal</dt><dd>' + esc(v.canal) + '</dd>' : '') +
        '<dt>Duração</dt><dd>' + (v.duracao_s ? tc(v.duracao_s) : 'o PC informa ao buscar') + '</dd>' +
        '<dt>Analisa</dt><dd>' + (textoTrecho(v) ? textoTrecho(v) : 'o vídeo inteiro') + '</dd>' +
        (v.ao_vivo_canal ? '<dt>Live</dt><dd>' + (v.ao_vivo ? '<b style="color:var(--perigo)">● no ar</b> na última captura' : 'encerrada') +
          (v.capturado_ate_s ? ' · capturado até <b>' + tc(v.capturado_ate_s) + '</b>' : ' · o PC ainda vai procurar') + '</dd>' : '') +
        '<dt>Etapa</dt><dd>' + etapas[v.etapa] + '</dd>' +
        '<dt>Importado</dt><dd>' + data(v.criado_em) + '</dd>' +
        (v.erro ? '<dt>Falha</dt><dd style="color:var(--perigo)">' + esc(v.erro) + '</dd>' : '') + '</dl>' +
        (v.erro ? '<div class="acoes"><button class="btn btn-ok" type="button" id="v-tentar">↻ Tentar de novo</button></div>' : '') +
        // 18/11: "Puxar o resto" - só para vídeo que veio do link da live, depois da 1ª captura
        (podePuxar(v)
          ? '<div class="bloco caixa-resto"><b class="resto-tit">⟳ Puxar mais ' + (v.ao_vivo_canal ? 'da live' : 'do vídeo') + '</b><div class="dupla">' +
            '<label class="campo"><span>De (onde parou)</span><input class="tc-campo" value="' + tc(capturado(v)) + '" disabled></label>' +
            '<label class="campo"><span>Até (vazio = até o fim)</span><input class="tc-campo" id="resto-ate" inputmode="numeric" autocomplete="off" placeholder="fim do vídeo"></label></div>' +
            '<div class="acoes resto-mais">' + [1, 2, 3].map(function (h) { return '<button type="button" class="mini" data-mais="' + h * 3600 + '">+' + h + ' h</button>'; }).join('') +
            '<button type="button" class="mini" data-mais="0">Até o fim</button></div>' +
            '<div class="acoes"><button class="btn btn-ok" type="button" id="v-resto"></button></div>' +
            '<p class="dica-trecho">O PC busca só essa parte e a IA lê só ela; os cortes que você já tem ficam. Dá para ir puxando aos poucos até o fim' +
            (v.duracao_s ? ' (na última captura o vídeo tinha ' + tc(v.duracao_s) + (v.ao_vivo ? ' e a live seguia no ar' : '') + ')' : '') + '.</p>' +
            '<p class="msg-form" id="msg-resto"></p></div>' : '') +
        '<form class="bloco" id="f-video"><label class="campo"><span>Título</span><input name="titulo" maxlength="200" value="' + esc(v.titulo || '') + '" placeholder="O PC preenche com o título original"></label>' +
        // 19/11: layout padrão dos curtos deste vídeo (vídeo novo do mesmo canal herda)
        '<div class="campo"><span>Layout vertical dos curtos</span><div class="linha-layout"><select name="layout">' +
          estado.layouts.map(function (l) { return '<option value="' + l.id + '"' + (v.layout_id === l.id ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; }).join('') +
          '<option value=""' + (!v.layout_id ? ' selected' : '') + '>Nenhum (só o horizontal)</option></select>' +
          '<button type="button" class="mini" id="v-layouts">Editar layouts</button></div>' +
          '<small class="dica-layout">Vale para todos os curtos deste vídeo (dá para trocar em cada corte). O próximo vídeo do mesmo canal já vem com ele.</small></div>' +
        // 19/11: contexto da live - a IA usa nos títulos/descrições e o Whisper acerta os nomes
        '<label class="campo"><span>Contexto da live (quem participa, o que está rolando)</span><textarea name="contexto" maxlength="1500" rows="3" placeholder="Ex.: Coringa e Tainá Costa numa live IRL com amigos provando os drinks do casamento. Convidados: Fulano, Ciclano.">' + esc(v.contexto || '') + '</textarea>' +
          '<small class="dica-layout">A IA usa nos títulos, descrições e tags, e a legenda passa a escrever esses nomes certo. Vale para os próximos textos e legendas (use "Refazer textos" no corte para aplicar já).</small></label>' +
        '<p class="msg-form" id="msg-video"></p><div class="acoes"><button class="btn btn-cor" type="submit">Salvar</button>' +
        '<button class="btn" type="button" id="v-marcar">+ Marcar corte</button></div></form>' +
        '<form class="bloco" id="f-trecho" novalidate><div class="dupla">' +
        '<label class="campo"><span>Analisar a partir de</span><input class="tc-campo" name="de" inputmode="numeric" autocomplete="off" placeholder="00:00:00" value="' + (v.analisar_de_s ? tc(v.analisar_de_s) : '') + '"></label>' +
        '<label class="campo"><span>Até (vazio = até o fim)</span><input class="tc-campo" name="ate" inputmode="numeric" autocomplete="off" placeholder="fim do vídeo" value="' + (v.analisar_ate_s ? tc(v.analisar_ate_s) : '') + '"></label></div>' +
        '<p class="dica-trecho">' + (v.etapa === 'entrada' ? 'O PC ainda não começou: muda sem custo.' : 'Mudar o trecho refaz a análise (o painel avisa o que muda antes).') + '</p>' +
        '<p class="msg-form" id="msg-trecho"></p><div class="acoes"><button class="btn" type="submit">Salvar trecho</button></div></form>' +
        '<div class="acoes"><button class="btn btn-fino esq" type="button" id="v-arquivar">Concluir vídeo</button><button class="btn btn-perigo" type="button" id="v-excluir">Excluir vídeo</button></div>',
        function (box) {
          box.querySelector('#f-video').onsubmit = function (ev) {
            ev.preventDefault();
            var titulo = this.titulo.value.trim(), lay = this.layout.value === '' ? null : Number(this.layout.value);
            api('/videos/' + v.id, { metodo: 'PATCH', corpo: { titulo: titulo, layout_id: lay, contexto: this.contexto.value } }).then(function () { aviso('Salvo.'); fecharGaveta(); carregar(); })
              .catch(function (e) { $('msg-video').textContent = e.message; });
          };
          box.querySelector('#v-marcar').onclick = function () { formCorte(null); };
          box.querySelector('#v-layouts').onclick = function () { CortexLayouts.abrir(v.layout_id || null); };
          var ft = box.querySelector('#f-trecho');
          mascaraTC(ft.de); mascaraTC(ft.ate);
          ft.onsubmit = function (ev) {
            ev.preventDefault();
            var tr = lerCamposTrecho(ft.de, ft.ate), msg = $('msg-trecho'), b = ft.querySelector('[type=submit]');
            if (tr.erro) { msg.textContent = tr.erro; return; }
            function enviar(confirmado) {
              b.disabled = true; msg.textContent = '';
              return api('/videos/' + v.id + '/trecho', { metodo: 'POST', corpo: { analisar_de_s: tr.de, analisar_ate_s: tr.ate, confirmado: confirmado } }).then(function (r) {
                aviso(r.refez === 'roteiro' ? 'Trecho salvo: a IA lê de novo só essa parte.' : r.refez === 'texto' ? 'Trecho salvo: o PC busca o texto dessa parte.' : 'Trecho salvo.');
                fecharGaveta(); detalhe = null; carregar().then(function () { if (selVideo) carregarDetalhe(selVideo); });
              }).catch(function (e) {
                b.disabled = false;
                if (e.status === 409 && e.dados && e.dados.confirmar) {
                  return confirmar(e.dados.confirmar + ' Continuar?', 'Refazer').then(function (sim) { if (sim) return enviar(true); });
                }
                msg.textContent = e.message;
              });
            }
            enviar(false);
          };
          var vr = box.querySelector('#v-resto');
          if (vr) {
            var ra = box.querySelector('#resto-ate');
            mascaraTC(ra, rotuloResto);
            ra.addEventListener('blur', rotuloResto);
            function rotuloResto() {
              var a = lerTC(ra.value);
              vr.textContent = '⟳ Puxar de ' + tc(capturado(v)) + (a != null ? ' até ' + tc(a) + ' (' + duracao(Math.max(0, a - capturado(v))) + ')' : ' até o fim');
            }
            rotuloResto();
            box.querySelectorAll('[data-mais]').forEach(function (b) {
              b.onclick = function () { var n = Number(b.dataset.mais); ra.value = n ? tc(capturado(v) + n) : ''; rotuloResto(); };
            });
            vr.onclick = function () {
              var txt = ra.value.trim(), a = txt ? lerTC(txt) : null;
              if (txt && a == null) { $('msg-resto').textContent = 'Tempo inválido. Use HH:MM:SS.'; return; }
              if (a != null && a - capturado(v) < 120) { $('msg-resto').textContent = 'O "até" precisa vir pelo menos 2 min depois de ' + tc(capturado(v)) + '.'; return; }
              puxarResto(v, vr, $('msg-resto'), a);
            };
          }
          var vt = box.querySelector('#v-tentar');
          if (vt) vt.onclick = function () { tentar('videos', v.id, vt).then(fecharGaveta); };
          box.querySelector('#v-arquivar').onclick = function () { concluirVideo(v); };
          box.querySelector('#v-excluir').onclick = function () {
            confirmar('Excluir este vídeo, a transcrição e todos os cortes dele? Os arquivos já baixados no PC ficam lá.').then(function (sim) {
              if (!sim) return;
              api('/videos/' + v.id, { metodo: 'DELETE' }).then(function () {
                aviso('Vídeo excluído.'); fecharGaveta(); selVideo = null; detalhe = null; desenharLinha(); carregar();
              }).catch(function (e) { aviso(e.message, true); });
            });
          };
          if (depois) depois(box);
        });
    });
  }

  function abrirCorte(id, doQuadro) {
    var c0 = estado.cortes.find(function (c) { return c.id === id; });
    var vid = c0 ? c0.video_id : selVideo;
    var pronto = (selVideo === vid && detalhe) ? Promise.resolve() : selecionar(vid);
    pronto.then(function () {
      var c = detalhe && detalhe.cortes.find(function (x) { return x.id === id; });
      if (c) formCorte(c);
    });
  }

  function ajustes(campo, livre, passo) {
    if (!livre) return '';
    passo = passo || 5;
    return '<span class="ajustes">' + [-passo, passo].map(function (d) {
      return '<button type="button" class="mini" data-campo="' + campo + '" data-ajuste="' + d + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + ' s</button>';
    }).join('') + '</span>';
  }

  // Corte aprovado sem baixar (15/11): tudo o que o dono precisa para baixar por fora,
  // cada item com o próprio botão de copiar. O site abre em outra aba.
  function blocoFora(c, v) {
    function linha(rot, val, mono) {
      return '<div class="fora-item"><span>' + rot + '</span><code' + (mono ? '' : ' class="txt"') + '>' + esc(val) + '</code><button type="button" class="mini" data-copia="' + esc(val) + '">Copiar</button></div>';
    }
    var textos = c.titulo + '\n\n' + descricaoPronta(c.descricao, c.tags || []) + ((c.tags || []).length ? '\n\nTAGS: ' + tagsStudio(c.tags) : '');
    return '<div class="caixa-fora"><b>BAIXAR FORA DO CORTEX</b>' +
      linha('Início', tc(c.inicio_s), true) + linha('Fim', tc(c.fim_s), true) +
      linha('Duração', duracao(c.fim_s - c.inicio_s), true) +
      (c.gancho_inicio_s != null ? linha('Gancho', tc(c.gancho_inicio_s - c.inicio_s) + ' → ' + tc(c.gancho_fim_s - c.inicio_s), true) : '') +
      linha('Vídeo', v.url, false) +
      '<div class="fora-acoes"><a class="btn btn-cor" href="https://kick-video.download" target="_blank" rel="noopener">Abrir kick-video.download ↗</a>' +
      '<button type="button" class="btn btn-fino" data-copia="' + esc(textos) + '">Copiar título, descrição e tags</button></div>' +
      // 18/11: a ficha .txt (título, gancho, tempos...) vai para a pasta dos cortes no PC, mesmo sem baixar o vídeo
      '<div class="fora-ficha"><span>📄 ' + esc(textoFicha(c)) + '</span>' +
      '<button type="button" class="mini" id="c-ficha">' + (c.arquivo_local ? 'Gravar de novo' : 'Gravar ficha no PC') + '</button></div></div>';
  }
  function textoFicha(c) {
    var q = estado.cortes.find(function (x) { return x.id === c.id; }) || {};
    if (q.tarefa_estado === 'pendente' || q.tarefa_estado === 'pega') return 'Ficha .txt na fila do PC…';
    if (c.arquivo_local) return 'Ficha no PC: ' + c.arquivo_local;
    if (q.tarefa_estado === 'falhou') return 'A ficha falhou no PC: ' + (c.erro || 'veja o cartão');
    return 'Ficha .txt ainda não gravada no PC.';
  }

  // ---------- legenda do curto: revisar e corrigir antes de baixar (19/11) ----------
  // As palavras vêm com o tempo de cada uma. Aqui elas aparecem em FRASES; trocar o texto de uma
  // frase mantém o tempo dela (o novo texto é repartido no mesmo intervalo).
  function frasesDe(palavras) {
    var out = [], atual = [];
    palavras.forEach(function (w) {
      var ant = atual[atual.length - 1], tam = atual.reduce(function (n, x) { return n + x.p.length + 1; }, 0) + w.p.length;
      if (atual.length && (atual.length >= 8 || tam > 42 || w.i - ant.f > 0.8 || /[.!?…]$/.test(ant.p))) { out.push(atual); atual = []; }
      atual.push(w);
    });
    if (atual.length) out.push(atual);
    return out;
  }
  function textoDe(g) { return g.map(function (w) { return w.p; }).join(' '); }
  function seg(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function editorLegenda(el, c) {
    var frases = null, sujo = false, vivo = true, extra = null;
    function carregarLeg() {
      if (!el.isConnected) return;
      api('/cortes/' + c.id + '/legenda').then(function (j) {
        frases = j.palavras && j.palavras.length ? frasesDe(j.palavras) : null; sujo = false;
        desenhar(j);
        if (j.tarefa && el.isConnected) setTimeout(carregarLeg, 6000);   // o PC está transcrevendo: confere de novo
      }).catch(function (e) { el.innerHTML = '<p class="leg-msg erro">' + esc(e.message) + '</p>'; });
    }
    function desenhar(j) {
      var pedir = '<button type="button" class="mini" id="leg-pedir">📝 Transcrever para revisar</button>';
      if (j.tarefa) {
        el.innerHTML = '<p class="leg-msg">⏳ ' + (j.tarefa.estado === 'pega' ? 'O PC está transcrevendo o áudio deste trecho…' :
          (estado.pc.online ? 'Na fila do PC: começa em instantes.' : 'Na fila: começa quando o PC ligar.')) + '</p>';
        return;
      }
      if (!frases) {
        el.innerHTML = (j.erro ? '<p class="leg-msg erro">A transcrição falhou: ' + esc(j.erro) + '</p>' : '') +
          '<p class="leg-msg">Leia e corrija a legenda <b>antes de aprovar</b>: o PC busca só o áudio deste trecho e o texto aparece aqui em ~1 min. ' +
          'Sem isso, o PC transcreve sozinho na hora de baixar.</p><div class="leg-acoes">' + pedir + '</div>';
        el.querySelector('#leg-pedir').onclick = pedirLeg;
        return;
      }
      el.innerHTML = '<p class="leg-msg">' + (j.editada ? '✓ Corrigida por você' : 'Texto do Whisper') + ' · corrija nomes e gírias; o tempo de cada frase continua o mesmo. No vídeo sai em MAIÚSCULAS.</p>' +
        '<div class="leg-lista">' + frases.map(function (g, k) {
          // 19/11: buraco de 3,5 s ou mais sem texto (o Whisper pulou ou não há fala): dá para escrever ali
          var ant = k ? frases[k - 1][frases[k - 1].length - 1].f : 0, buraco = g[0].i - ant >= 3.5 ? '<label class="leg-linha leg-buraco"><span class="leg-tc">' + seg(ant) + '</span>' +
            '<input data-buraco="' + k + '" placeholder="⚠ ' + Math.round(g[0].i - ant) + ' s sem legenda: escreva o que é falado aqui (ou deixe vazio)" maxlength="200"></label>' : '';
          return buraco + '<label class="leg-linha"><span class="leg-tc">' + seg(g[0].i) + '</span><input data-k="' + k + '" value="' + esc(textoDe(g)) + '" maxlength="200">' +
            '<button type="button" class="leg-apaga" data-apaga="' + k + '" title="Apagar esta frase (não foi dita)" aria-label="Apagar esta frase">✕</button></label>';
        }).join('') + (function () {
          // buraco no FIM do corte (depois da última frase)
          var ult = frases[frases.length - 1], fimU = ult[ult.length - 1].f, durC = c.fim_s - c.inicio_s;
          return durC - fimU >= 3.5 ? '<label class="leg-linha leg-buraco"><span class="leg-tc">' + seg(fimU) + '</span><input data-buraco="' + frases.length + '" placeholder="⚠ ' +
            Math.round(durC - fimU) + ' s sem legenda no fim: escreva o que é falado aqui (ou deixe vazio)" maxlength="200"></label>' : '';
        })() + '</div>' +
        '<p class="leg-msg erro" id="leg-erro" hidden></p>' +
        '<div class="leg-acoes"><button type="button" class="mini sim" id="leg-salvar" disabled>Salvar legenda</button>' +
        '<button type="button" class="mini" id="leg-refazer">Transcrever de novo</button></div>';
      el.querySelectorAll('.leg-lista input').forEach(function (i) { i.oninput = function () { sujo = true; el.querySelector('#leg-salvar').disabled = false; }; });
      // 20/11: ✕ apaga a frase inventada com um toque (vazia = sai da legenda ao salvar)
      el.querySelectorAll('[data-apaga]').forEach(function (b) {
        b.onclick = function (ev) {
          ev.preventDefault();
          var inp = el.querySelector('input[data-k="' + b.dataset.apaga + '"]');
          inp.value = ''; inp.placeholder = '(apagada - some ao salvar)'; sujo = true; el.querySelector('#leg-salvar').disabled = false;
        };
      });
      el.querySelector('#leg-salvar').onclick = function () { salvar(); };
      el.querySelector('#leg-refazer').onclick = function () {
        confirmar('Transcrever de novo? ' + (j.editada || sujo ? 'As suas correções nesta legenda se perdem.' : 'O texto atual é trocado pelo novo.'), 'Transcrever').then(function (sim) { if (sim) pedirLeg(); });
      };
    }
    function pedirLeg() {
      api('/cortes/' + c.id + '/legenda', { metodo: 'POST' }).then(function () { carregarLeg(); })
        .catch(function (e) { aviso(e.message, true); });
    }
    // Junta o que está nos campos: frase igual mantém as palavras (e o tempo de cada uma); frase
    // mudada reparte o intervalo dela entre as palavras novas, pelo tamanho de cada uma.
    function juntar() {
      var out = [];
      el.querySelectorAll('.leg-lista input').forEach(function (inp) {
        var txt = inp.value.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
        if (inp.dataset.buraco !== undefined) {
          // texto escrito num buraco: ocupa o espaço entre a frase anterior e a próxima
          var kb = Number(inp.dataset.buraco), a0 = kb ? frases[kb - 1][frases[kb - 1].length - 1].f + 0.15 : 0,
            b0 = kb < frases.length ? frases[kb][0].i - 0.15 : (c.fim_s - c.inicio_s) - 0.3;
          if (txt) repartir(txt, a0, b0, out);
          return;
        }
        var g = frases[Number(inp.dataset.k)];
        if (txt === textoDe(g)) { out.push.apply(out, g); return; }
        if (!txt) return;
        repartir(txt, g[0].i, g[g.length - 1].f, out);
      });
      return out;
    }
    function repartir(txt, ini, fim, out) {
      var ps = txt.split(' '), total = ps.reduce(function (n, x) { return n + x.length + 1; }, 0), t = ini;
      ps.forEach(function (p) { var d = (fim - ini) * (p.length + 1) / total; out.push({ p: p.slice(0, 40), i: +t.toFixed(2), f: +(t + d).toFixed(2) }); t += d; });
    }
    function salvar() {
      var b = el.querySelector('#leg-salvar'), er = el.querySelector('#leg-erro'), palavras = juntar();
      if (!palavras.length) { er.hidden = false; er.textContent = 'A legenda ficou vazia. Para tirar a legenda, escolha o layout "Nenhum".'; return Promise.resolve(false); }
      b.disabled = true; er.hidden = true;
      return api('/cortes/' + c.id + '/legenda', { metodo: 'PUT', corpo: { palavras: palavras } }).then(function () {
        aviso('Legenda salva.'); carregarLeg(); return true;
      }).catch(function (e) { b.disabled = false; er.hidden = false; er.textContent = e.message; return false; });
    }
    carregarLeg();
    return { salvarSePreciso: function () { return sujo && frases ? salvar() : Promise.resolve(true); } };
  }

  // ---------- pronto para colar (19/11): o mesmo que a ficha .txt do PC monta ----------
  function hashtagsDe(tags) {
    var vistas = {};
    return (tags || []).map(function (t) { return '#' + String(t).replace(/^#/, '').replace(/[^\p{L}\p{N}_]+/gu, ''); })
      .filter(function (h) { var k = h.toLowerCase(); if (h.length < 2 || vistas[k]) return false; vistas[k] = 1; return true; });
  }
  // descrição sem a linha de hashtags do fim + uma linha só de hashtags (as da descrição mandam), sem repetir, poucas
  function descricaoPronta(desc, tags) {
    var linhas = String(desc || '').replace(/\r/g, '').split('\n'), daDesc = [];
    while (linhas.length && (!linhas[linhas.length - 1].trim() || /^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(linhas[linhas.length - 1].trim()))) {
      var l = linhas.pop().trim(); if (l) daDesc = l.split(/[\s,]+/).filter(Boolean).concat(daDesc);
    }
    var vistas = {}, hs = [];
    // 21/11 (padrão editorial): poucas hashtags. As da descrição mandam (até 5); só sem nenhuma lá
    // é que entram 4 tiradas das tags.
    (daDesc.length ? daDesc : hashtagsDe(tags)).forEach(function (h) { var k = h.toLowerCase(); if (h.length > 1 && !vistas[k] && hs.length < (daDesc.length ? 5 : 4)) { vistas[k] = 1; hs.push(h); } });
    var corpo = linhas.join('\n').trim();
    return (corpo + (hs.length ? (corpo ? '\n\n' : '') + hs.join(' ') : '')).trim();
  }
  // campo Tags do YouTube Studio: vírgulas, até 500 caracteres (tag com espaço conta +2)
  function tagsStudio(tags) {
    var out = [], n = 0;
    (tags || []).some(function (t) { var c = t.length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0); if (n + c > 500) return true; out.push(t); n += c; return false; });
    return out.join(', ');
  }
  function listaTags(txt) { return String(txt || '').split(',').map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean); }

  // ---------- textos de publicação no padrão do canal (19/11) ----------
  function lerLista(x) { if (Array.isArray(x)) return x; try { var a = JSON.parse(x || 'null'); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
  function blocoTextosIA(c) {
    var ts = lerLista(c.titulos) || [];
    return (ts.length ? '<div class="tit-opcoes"><span class="tit-rot">Opções da IA (toque para usar)</span>' +
        ts.map(function (t, k) { return '<button type="button" class="tit-op' + (t === c.titulo ? ' on' : '') + '" data-tit="' + k + '">' + (k + 1) + '. ' + esc(t) + '</button>'; }).join('') +
        (c.titulo_porque ? '<p class="tit-porque"><b>Melhor:</b> ' + esc(c.titulo_porque) + '</p>' : '') + '</div>' : '') +
      (c.duvida ? '<p class="tit-duvida">⚠ A IA ficou com dúvida: ' + esc(c.duvida) + ' Escreva no "Contexto da live" (gaveta do vídeo) e refaça os textos.</p>' : '') +
      (c.thumb ? '<div class="tit-thumb"><b>THUMBNAIL</b>' + esc(c.thumb) + '</div>' : '') +
      '<div class="tit-acoes"><button type="button" class="mini" id="c-textos">✨ Refazer textos com a IA</button>' +
      '<small>Título (3 opções), descrição, tags e thumbnail no padrão do canal. Só grava ao apertar Salvar.</small></div>';
  }

  // Formulário de corte: novo (c = null) ou existente.
  function formCorte(c) {
    var v = detalhe.video, novo = !c;
    c = c || { tipo: 'curto', inicio_s: '', fim_s: '', titulo: '', descricao: '', tags: [], gancho: '', estado: 'triagem', origem: 'manual' };
    // Tempo muda na triagem e no 'Baixar de novo' (edição): o PC baixa com o tempo novo.
    var tempoLivre = ['triagem', 'descartado', 'edicao'].indexOf(c.estado) >= 0;
    var fora = !novo && c.baixar_fora && c.estado === 'edicao';
    var nomes = { triagem: 'Triagem', download: 'Na fila do PC', edicao: fora ? 'Aprovado: baixar fora do Cortex' : 'Pronto para o Movavi', publicado: 'Publicado', descartado: 'Descartado' };
    var acoesEstado = '';
    if (!novo) {
      if (c.estado === 'triagem') acoesEstado = '<button class="btn btn-ok" type="button" data-ir="download">✓ Aprovar e baixar</button>' +
        (c.tipo === 'longo' ? '<button class="btn" type="button" data-ir="edicao">↗ Aprovar sem baixar</button>' : '') +
        '<button class="btn btn-fino" type="button" data-ir="descartado">Descartar</button>';
      else if (fora) acoesEstado = '<button class="btn btn-ok" type="button" data-ir="publicado">✓ Marcar publicado</button><button class="btn btn-fino" type="button" data-ir="download">Baixar pelo PC</button><button class="btn btn-fino" type="button" data-ir="triagem">Voltar para a triagem</button>';
      else if (c.estado === 'descartado') acoesEstado = '<button class="btn" type="button" data-ir="triagem">Voltar para a triagem</button>';
      else if (c.estado === 'download') acoesEstado = '<button class="btn btn-fino" type="button" data-ir="triagem">Cancelar download</button>';
      else if (c.estado === 'edicao') acoesEstado = '<button class="btn btn-ok" type="button" data-ir="publicado">✓ Marcar publicado</button><button class="btn btn-fino" type="button" data-ir="download">Baixar de novo</button>';
      else if (c.estado === 'publicado') acoesEstado = '<button class="btn btn-fino" type="button" data-ir="edicao">Voltar para a edição</button>';
    }
    var ia = novo ? '' : caixaIA(c);
    abrirGaveta(novo ? 'Marcar corte' : c.titulo,
      (novo ? '<p style="margin:0;color:var(--suave);font-size:.84rem">Em <b style="color:var(--texto)">' + esc(v.titulo || v.url) + '</b>. Só é criado ao apertar Salvar.</p>'
            : '<dl class="info"><dt>Estado</dt><dd>' + nomes[c.estado] + '</dd><dt>Origem</dt><dd>' + (c.origem === 'ia' ? 'Sugerido pela IA' : 'Marcado à mão') + '</dd>' +
              (c.arquivo_local ? '<dt>No PC</dt><dd style="font-family:var(--mono);font-size:.78rem">' + esc(c.arquivo_local) + '</dd>' : '') +
              (c.qualidade ? '<dt>Qualidade</dt><dd style="font-family:var(--mono);font-size:.78rem">' + esc(c.qualidade) + '</dd>' : '') +
              (c.erro ? '<dt>Falha</dt><dd style="color:var(--perigo)">' + esc(c.erro) + '</dd>' : '') + '</dl>') +
      ia + (fora ? blocoFora(c, v) : '') +
      (acoesEstado ? '<div class="acoes">' + acoesEstado + '</div>' : '') +
      '<form class="bloco" id="f-corte" novalidate>' +
      '<div class="campo"><span>Tipo</span><div class="escolha" id="esc-tipo"><button type="button" data-v="curto">Curto · 45-90 s</button><button type="button" data-v="longo">Longo · 30-40 min</button></div></div>' +
      // 19/11: layout do vertical 9:16 (só curto). O PC gera o 1080x1920 pronto na pasta Shorts.
      '<div class="campo" id="campo-layout"><span>Vertical 9:16 (layout)</span>' + (novo ? '' : blocoCena(c)) + '<div class="linha-layout"><select name="layout">' +
        opcoesLayout(c.layout_id == null ? null : c.layout_id, 'Padrão do vídeo' + (v.layout_id ? ' (' + (nomeLayout(v.layout_id) || 'layout') + ')' : ' (nenhum)')) +
        '</select><button type="button" class="mini" id="c-layouts">Editar layouts</button></div>' +
        '<small class="dica-layout">' + (c.estado === 'edicao' && !fora ? 'Mudou o layout? Use <b>Baixar de novo</b> para gerar o vertical com ele.' : 'Com layout, o corte sai só na pasta Shorts: vertical pronto e legendado. Com "Nenhum", sai horizontal em Curtos, sem legenda.') + '</small></div>' +
      // 19/11: legenda do curto para revisar e corrigir antes de baixar (o Whisper erra nomes)
      (!novo && c.tipo === 'curto' && !fora && (c.estado === 'triagem' || c.estado === 'edicao') ? '<div class="campo" id="campo-legenda"><span>Legenda do vertical</span><div id="leg-corpo"><p class="leg-msg">Carregando…</p></div></div>' : '') +
      '<div class="dupla"><label class="campo"><span>Início</span><input class="tc-campo" name="inicio" inputmode="numeric" placeholder="00:00:00" value="' + (c.inicio_s === '' ? '' : tc(c.inicio_s)) + '"' + (tempoLivre ? '' : ' disabled') + '>' + ajustes('inicio', tempoLivre) + '</label>' +
      '<label class="campo"><span>Fim</span><input class="tc-campo" name="fim" inputmode="numeric" placeholder="00:00:00" value="' + (c.fim_s === '' ? '' : tc(c.fim_s)) + '"' + (tempoLivre ? '' : ' disabled') + '>' + ajustes('fim', tempoLivre) + '</label></div>' +
      (c.estado === 'edicao' ? '<p style="margin:-.2rem 0 0;font-size:.78rem;color:var(--suave)">' + (fora ? 'Sem arquivo no PC: ajuste o tempo e aperte <b>Salvar</b>.' : 'Mudou o tempo? Use <b>Baixar de novo</b>: o PC baixa com o tempo novo.') + '</p>' : '') +
      '<p style="margin:-.2rem 0 0;font:.74rem var(--mono);color:var(--suave)" id="dur-corte"></p>' +
      '<label class="campo"><span>Título</span><input name="titulo" maxlength="150" value="' + esc(c.titulo) + '" placeholder="Título de alto clique"></label>' +
      // 19/11: padrão do canal - 3 opções de título da IA, o porquê, thumbnail e "Refazer textos"
      (novo ? '' : '<div id="textos-ia">' + blocoTextosIA(c) + '</div>') +
      '<label class="campo"><span>Gancho (primeiros segundos)</span><input name="gancho" maxlength="300" value="' + esc(c.gancho || '') + '" placeholder="A frase que segura quem está rolando o feed"></label>' +
      // 15/11: onde o gancho é dito (tempo do vídeo original); abaixo, o tempo dentro do arquivo do corte.
      '<div class="dupla"><label class="campo"><span>Gancho começa</span><input class="tc-campo" name="g_inicio" inputmode="numeric" placeholder="00:00:00" value="' + (c.gancho_inicio_s == null ? '' : tc(c.gancho_inicio_s)) + '">' + ajustes('g_inicio', true, 1) + '</label>' +
      '<label class="campo"><span>Gancho termina</span><input class="tc-campo" name="g_fim" inputmode="numeric" placeholder="00:00:00" value="' + (c.gancho_fim_s == null ? '' : tc(c.gancho_fim_s)) + '">' + ajustes('g_fim', true, 1) + '</label></div>' +
      '<p class="dica-gancho" id="dica-gancho"></p>' +
      '<label class="campo"><span>Descrição</span><textarea name="descricao" maxlength="5000">' + esc(c.descricao || '') + '</textarea></label>' +
      '<label class="campo"><span>Tags (separadas por vírgula)</span><input name="tags" value="' + esc((c.tags || []).join(', ')) + '" placeholder="gta 6, trailer, rockstar"></label>' +
      // 19/11: pronto para colar no YouTube (o que está nos campos agora, mesmo antes de salvar)
      (novo ? '' : '<div class="pub"><b class="pub-tit">PARA PUBLICAR · COPIE E COLE</b>' +
        '<div class="pub-linha"><span>Título</span><button type="button" class="mini" data-pub="titulo">Copiar</button></div>' +
        '<div class="pub-linha"><span>Descrição <small>com as hashtags (poucas, sem repetir)</small></span><button type="button" class="mini" data-pub="descricao">Copiar</button></div>' +
        '<div class="pub-linha"><span>Tags <small>campo "Tags" do YouTube Studio</small></span><button type="button" class="mini" data-pub="tags">Copiar</button></div></div>') +
      '<p class="msg-form" id="msg-corte"></p>' +
      '<div class="acoes"><button class="btn btn-cor" type="submit">Salvar</button><button class="btn btn-fino" type="button" id="c-cancelar">Cancelar</button>' +
      (novo ? '' : '<button class="btn btn-perigo" type="button" id="c-excluir" style="margin-left:auto">Excluir</button>') + '</div></form>',
      function (box) {
        var f = box.querySelector('#f-corte'), tipo = c.tipo;
        box.querySelectorAll('[data-copia]').forEach(function (b) { b.onclick = function () { copiar(b, b.dataset.copia); }; });
        var bf = box.querySelector('#c-ficha');
        if (bf) bf.onclick = function () {
          bf.disabled = true;
          api('/cortes/' + c.id + '/ficha', { metodo: 'POST' }).then(function () {
            aviso(estado.pc.online ? 'O PC já vai gravar a ficha na pasta dos cortes.' : 'Na fila: quando o PC ligar, ele grava a ficha.');
            bf.textContent = 'Na fila do PC'; carregar();
          }).catch(function (e) { bf.disabled = false; aviso(e.message, true); });
        };
        function marcarTipo() {
          box.querySelectorAll('#esc-tipo button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === tipo); });
          box.querySelector('#campo-layout').hidden = tipo !== 'curto';     // vertical só para curto
        }
        // 19/11: o editor abre com a FOTO deste corte por trás (ajusta o recorte na cena certa)
        box.querySelector('#c-layouts').onclick = function () {
          var ft = box.querySelector('#cena-foto'), lid = Number(f.layout.value) || (f.layout.value === '' ? v.layout_id : null) || null;
          var opc = ft && ft.naturalWidth ? { foto: ft.src, rotulo: 'foto do corte (' + tc(c.quadro_s) + ')' } : {};
          // 19/11: ao fechar o editor, a gaveta já mostra o layout salvo (com as medidas novas) e o corte
          // passa a usar ele - nada de trocar de layout e voltar para atualizar.
          opc.aoFechar = function (salvo) {
            var antes = f.layout.value;
            f.layout.innerHTML = opcoesLayout(null, 'Padrão do vídeo' + (v.layout_id ? ' (' + (nomeLayout(v.layout_id) || 'layout') + ')' : ' (nenhum)'));
            f.layout.value = salvo ? String(salvo) : antes;
            desenharCena(box, layoutDoSelect());
            if (!salvo || !box.isConnected) return;
            if (c.estado !== 'triagem' && c.estado !== 'edicao') return;
            api('/cortes/' + c.id, { metodo: 'PATCH', corpo: { layout_id: salvo } }).then(function () {
              c.layout_id = salvo; c.cena_auto = 0;
              var lc = box.querySelector('.cena-linha span'); if (lc) lc.innerHTML = lc.innerHTML.replace(' · layout escolhido pela cena', '');
              aviso('Este corte agora usa o layout "' + (nomeLayout(salvo) || 'salvo') + '"' + (c.estado === 'edicao' ? '. Use "Baixar de novo" para gerar o vertical com ele.' : '.'));
              carregar();
            }).catch(function (e) { aviso(e.message, true); });
          };
          CortexLayouts.abrir(lid, opc);
        };
        var leg = box.querySelector('#campo-legenda') ? editorLegenda(box.querySelector('#leg-corpo'), c) : null;
        // 19/11: textos da IA. `extrasIA` vai junto no Salvar/Aprovar quando o dono refez os textos.
        var extrasIA = null, cTextos = { titulos: c.titulos, titulo_porque: c.titulo_porque, thumb: c.thumb, duvida: c.duvida, titulo: c.titulo };
        function ligarTextos() {
          var areaT = box.querySelector('#textos-ia'); if (!areaT) return;
          areaT.querySelectorAll('[data-tit]').forEach(function (b) {
            b.onclick = function () {
              f.titulo.value = (lerLista(cTextos.titulos) || [])[Number(b.dataset.tit)] || f.titulo.value;
              areaT.querySelectorAll('[data-tit]').forEach(function (x) { x.classList.toggle('on', x === b); });
            };
          });
          var bt = areaT.querySelector('#c-textos');
          bt.onclick = function () {
            bt.disabled = true; bt.textContent = '✨ A IA está escrevendo…';
            api('/cortes/' + c.id + '/textos', { metodo: 'POST' }).then(function (r) {
              extrasIA = { titulos: r.titulos || [], titulo_porque: r.titulo_porque, thumb: r.thumb, duvida: r.duvida, motivo: r.motivo };
              cTextos = Object.assign({}, extrasIA, { titulo: r.titulo });
              if (r.titulo) f.titulo.value = r.titulo;
              if (r.descricao) f.descricao.value = r.descricao;
              if (r.tags && r.tags.length) f.tags.value = r.tags.join(', ');
              areaT.innerHTML = blocoTextosIA(cTextos); ligarTextos();
              aviso('Textos novos no formulário. Confira e aperte Salvar.');
            }).catch(function (e) { bt.disabled = false; bt.textContent = '✨ Refazer textos com a IA'; aviso(e.message, true); });
          };
        }
        ligarTextos();
        ligarCaixaIA(box, c);
        box.querySelectorAll('[data-pub]').forEach(function (b) {
          b.onclick = function () {
            var tg = listaTags(f.tags.value), q = b.dataset.pub;
            copiar(b, q === 'titulo' ? f.titulo.value.trim() : q === 'tags' ? tagsStudio(tg) : descricaoPronta(f.descricao.value, tg));
          };
        });
        // 19/11: foto do corte com o recorte do layout escolhido por cima + prévia do vertical
        function layoutDoSelect() {
          var val = f.layout.value, id = val === '' ? v.layout_id : Number(val);
          return id ? estado.layouts.find(function (l) { return l.id === id; }) || null : null;
        }
        f.layout.addEventListener('change', function () { desenharCena(box, layoutDoSelect()); });
        var foto = box.querySelector('#cena-foto');
        if (foto) { if (foto.complete) desenharCena(box, layoutDoSelect()); else foto.onload = function () { desenharCena(box, layoutDoSelect()); }; foto.onerror = function () { box.querySelector('#cena-img').hidden = true; }; }
        var bfo = box.querySelector('#c-foto');
        if (bfo) bfo.onclick = function () {
          bfo.disabled = true;
          api('/cortes/' + c.id + '/foto', { metodo: 'POST' }).then(function () {
            aviso(estado.pc.online ? 'O PC já vai tirar a foto de novo.' : 'Na fila: quando o PC ligar, ele tira a foto.');
            bfo.textContent = 'Foto na fila do PC';
          }).catch(function (e) { bfo.disabled = false; aviso(e.message, true); });
        };
        function layoutEscolhido() { return tipo !== 'curto' ? undefined : f.layout.value === '' ? null : Number(f.layout.value); }
        marcarTipo();
        if (leg) box.querySelector('#esc-tipo').addEventListener('click', function () { box.querySelector('#campo-legenda').hidden = tipo !== 'curto'; });
        box.querySelector('#esc-tipo').onclick = function (ev) { var b = ev.target.closest('button'); if (b) { tipo = b.dataset.v; marcarTipo(); mostrarDur(); } };
        // máscara de timecode: só dígitos e ":", e completa os ":" ao sair do campo
        [f.inicio, f.fim, f.g_inicio, f.g_fim].forEach(function (el) {
          el.addEventListener('input', function () { this.value = this.value.replace(/[^\d:]/g, '').slice(0, 8); mostrarDur(); });
          el.addEventListener('blur', function () { var s = lerTC(this.value); if (s != null) this.value = tc(s); });
        });
        function mostrarDur() {
          var a = lerTC(f.inicio.value), b = lerTC(f.fim.value), el = box.querySelector('#dur-corte');
          el.textContent = a != null && b != null && b > a ? 'Duração: ' + duracao(b - a) : '';
          // tempo do gancho dentro do arquivo do corte = o que aparece na linha do tempo do Movavi
          var gi = lerTC(f.g_inicio.value), gf = lerTC(f.g_fim.value), d = box.querySelector('#dica-gancho');
          if (gi == null || gf == null) {
            d.innerHTML = f.g_inicio.value || f.g_fim.value ? '' : 'Tempo do vídeo original. Vazio = sem tempo marcado. ' +
              '<button type="button" class="mini" id="g-estimar">Marcar no começo do corte</button>';
            var be = d.querySelector('#g-estimar');
            if (be) be.onclick = estimarGancho;
          }
          else if (a == null || b == null || gi < a || gf > b || gf <= gi) d.textContent = '⚠ O gancho precisa ficar dentro do corte (' + (a != null ? tc(a) : '?') + ' → ' + (b != null ? tc(b) : '?') + ').';
          else {
            d.textContent = 'No arquivo do corte (Movavi): ' + tc(gi - a) + ' → ' + tc(gf - a) + ' · ' + duracao(gf - gi);
            // 23/11 (YouTube Studio: o Short se decide nos 2 primeiros segundos): curto que demora a
            // chegar no gancho ganha o aviso e o botão que puxa o começo para 1 s antes dele.
            if (tipo === 'curto' && gi - a > 3 && b - (gi - 1) >= 15) {
              d.innerHTML = '<span class="frio">⚠ O gancho só aparece aos ' + Math.round(gi - a) + ' s do corte. No Shorts a pessoa decide em 2 s se fica.</span> ' +
                '<button type="button" class="mini" id="g-comecar">Começar no gancho</button>';
              d.querySelector('#g-comecar').onclick = function () { f.inicio.value = tc(gi - 1); mostrarDur(); };
            }
          }
        }
        // 17/11: corte sem tempo do gancho -> começo do corte + duração da frase (~2,5 palavras/s).
        // O curto começa no gancho; o resto se acerta com os botões ±1 s.
        function estimarGancho() {
          var a = lerTC(f.inicio.value), b = lerTC(f.fim.value);
          if (a == null) return;
          var palavras = f.gancho.value.trim().split(/\s+/).filter(Boolean).length;
          var fala = Math.min(15, Math.max(2, Math.round(palavras / 2.5)));
          f.g_inicio.value = tc(a); f.g_fim.value = tc(b != null ? Math.min(b, a + fala) : a + fala);
          mostrarDur();
        }
        mostrarDur();
        box.querySelector('#c-cancelar').onclick = fecharGaveta;
        function tempoGancho() {
          var gi = f.g_inicio.value.trim(), gf = f.g_fim.value.trim();
          if ((gi && lerTC(gi) == null) || (gf && lerTC(gf) == null)) return { erro: 'Tempo do gancho no formato 00:00:00.' };
          if (!gi !== !gf) return { erro: 'Preencha os dois tempos do gancho (ou deixe os dois vazios).' };
          return { gancho_inicio_s: gi ? lerTC(gi) : null, gancho_fim_s: gf ? lerTC(gf) : null };
        }
        // botões −5 s / +5 s ao lado do início e do fim
        box.querySelectorAll('[data-ajuste]').forEach(function (b) {
          b.onclick = function () {
            var el = f[b.dataset.campo], s = lerTC(el.value);
            // 17/11: gancho vazio + "±1 s" parte do começo do corte (antes não fazia nada)
            if (s == null && /^g_/.test(b.dataset.campo)) { estimarGancho(); return; }
            if (s == null) return;
            el.value = tc(Math.max(0, s + Number(b.dataset.ajuste))); mostrarDur();
          };
        });
        box.querySelectorAll('[data-ir]').forEach(function (b) {
          b.onclick = function () {
            var extra = null, msg = box.querySelector('#msg-corte');
            if (b.dataset.ir === 'download' || (b.dataset.ir === 'edicao' && c.estado === 'triagem')) {
              // Aprovar / baixar de novo leva junto o que foi editado no formulário.
              var ini = lerTC(f.inicio.value), fim = lerTC(f.fim.value);
              if (ini == null || fim == null) { msg.textContent = 'Preencha início e fim no formato 00:00:00.'; return; }
              var tg = tempoGancho(); if (tg.erro) { msg.textContent = tg.erro; return; }
              extra = Object.assign({ tipo: tipo, inicio_s: ini, fim_s: fim, titulo: f.titulo.value.trim(), gancho: f.gancho.value.trim(),
                descricao: f.descricao.value.trim(), tags: f.tags.value, layout_id: layoutEscolhido() }, tg, extrasIA || {});
            }
            (leg && b.dataset.ir === 'download' ? leg.salvarSePreciso() : Promise.resolve(true)).then(function (seguir) {
              if (seguir) return mudarEstado(c.id, b.dataset.ir, b, extra).then(function (ok) { if (ok) fecharGaveta(); });
            });
          };
        });
        var ex = box.querySelector('#c-excluir');
        if (ex) ex.onclick = function () {
          confirmar('Excluir o corte "' + c.titulo + '"? O arquivo já baixado no PC fica lá.').then(function (sim) {
            if (!sim) return;
            api('/cortes/' + c.id, { metodo: 'DELETE' }).then(function () { aviso('Corte excluído.'); fecharGaveta(); carregar(); })
              .catch(function (e) { aviso(e.message, true); });
          });
        };
        f.onsubmit = function (ev) {
          ev.preventDefault();
          var msg = box.querySelector('#msg-corte');
          var ini = lerTC(f.inicio.value), fim = lerTC(f.fim.value);
          if (ini == null || fim == null) { msg.textContent = 'Preencha início e fim no formato 00:00:00.'; return; }
          var tg = tempoGancho(); if (tg.erro) { msg.textContent = tg.erro; return; }
          var corpo = Object.assign({ tipo: tipo, inicio_s: ini, fim_s: fim, titulo: f.titulo.value.trim(), gancho: f.gancho.value.trim(),
            descricao: f.descricao.value.trim(), tags: f.tags.value, layout_id: layoutEscolhido() }, tg, novo ? {} : extrasIA || {});
          if (novo) corpo.video_id = v.id;
          var btn = f.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = '';
          api(novo ? '/cortes' : '/cortes/' + c.id, { metodo: novo ? 'POST' : 'PATCH', corpo: corpo }).then(function () {
            aviso(novo ? 'Corte marcado: está na triagem.' : 'Salvo.'); fecharGaveta(); carregar();
          }).catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
        };
      });
  }

  // ---------- PCs (agente que roda em casa e no trabalho) ----------
  var PAINEL = location.origin;
  function copiar(botao, texto) {
    var feito = function () { var t = botao.textContent; botao.textContent = 'Copiado'; setTimeout(function () { botao.textContent = t; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(feito, function () { aviso('Não consegui copiar: selecione o texto e copie.', true); });
    else aviso('Selecione o texto e copie.', true);
  }
  function blocoCmd(id, texto) {
    return '<pre class="cmd" id="' + id + '">' + esc(texto) + '<button type="button" class="mini" data-copiar="' + id + '">Copiar</button></pre>';
  }
  function ligarCopiar(box) {
    box.querySelectorAll('[data-copiar]').forEach(function (b) {
      b.onclick = function () { var pre = $(b.dataset.copiar); copiar(b, pre.firstChild.textContent); };
    });
  }
  var INSTALAR = 'winget install OpenJS.NodeJS.LTS\nwinget install yt-dlp.yt-dlp\nwinget install Gyan.FFmpeg';

  function LIGAR() {
    return 'cd C:\\Cortex\n' +
      'Invoke-WebRequest -UseBasicParsing ' + PAINEL + '/projetos/cortex/agente/cortex-agente.mjs -OutFile cortex-agente.mjs\n' +
      'node cortex-agente.mjs criar-atalho';
  }

  function abrirPCs() {
    api('/agentes').then(function (j) {
      var lista = j.agentes;
      var itens = lista.map(function (a) {
        var f = a.ferramentas || {};
        return '<div class="pc-item"><div class="pc-cab"><b>' + esc(a.nome) + '</b><span class="pc-st' + (a.online ? ' on' : '') + '">' + (a.online ? 'ONLINE' : 'OFFLINE') + '</span></div>' +
          '<div class="pc-det">' + (a.visto_em ? 'Visto por último ' + data(a.visto_em) : 'Ainda não falou com o painel') +
          (a.versao ? ' · agente ' + esc(a.versao) + (a.desatualizado ? ' (atualiza sozinho ao reiniciar)' : '') : '') +
          (f.ytdlp ? ' · yt-dlp ' + esc(f.ytdlp) : '') + '</div>' +
          '<div class="simnao"><span>Recebe os downloads de corte?</span><button type="button" data-baixa="' + a.id + '" data-v="1" class="' + (a.baixa_cortes ? 'on' : '') + '">Sim</button>' +
          '<button type="button" data-baixa="' + a.id + '" data-v="0" class="nao' + (a.baixa_cortes ? '' : ' on') + '">Não</button></div>' +
          // 18/11: pasta dos cortes escolhida aqui (antes só por comando no PC). "Usando agora" = o que o PC contou.
          (a.baixa_cortes ? '<form class="pc-pasta" data-pasta-form="' + a.id + '" novalidate>' +
            '<label class="campo"><span>Pasta dos cortes neste PC</span><input name="pasta" autocomplete="off" spellcheck="false" maxlength="240" value="' + esc(a.pasta || a.pasta_atual || '') + '" placeholder="D:\\Meus Documentos\\Vídeos\\Cortex"></label>' +
            '<p class="pc-det">' + (a.pasta_atual ? 'Usando agora: <code>' + esc(a.pasta_atual) + '</code>' : 'O PC ainda não contou qual pasta usa (precisa do agente 1.8.3, que chega sozinho).') +
            (a.pasta && a.pasta_atual && a.pasta !== a.pasta_atual ? '<br><b style="color:var(--curto)">Pasta nova salva: o PC passa a usar no próximo download.</b>' : '') + '</p>' +
            '<p class="msg-form"></p><div class="acoes"><button class="btn btn-fino" type="submit">Salvar pasta</button></div></form>' : '') +
          '<div class="acoes"><button type="button" class="btn btn-perigo btn-fino" data-desligar="' + a.id + '" data-nome="' + esc(a.nome) + '">Desconectar</button></div></div>';
      }).join('');
      abrirGaveta('PCs conectados',
        '<p style="margin:0;color:var(--metal);font-size:.84rem">O painel decide; o PC só baixa. Buscar o texto de um vídeo qualquer PC ligado faz. O vídeo do corte vai só para o PC marcado com <b>Sim</b> em "Recebe os downloads".</p>' +
        (lista.length ? '<div class="pcs">' + itens + '</div>' : '<p class="alerta">Nenhum PC conectado ainda. Conecte o primeiro abaixo.</p>') +
        (lista.length ? '<div class="passo"><h3><i>⏻</i>Ligar e desligar o Cortex num PC já conectado</h3>' +
          '<p>Se ainda não tem o atalho <b>Cortex - ligar e desligar</b> na área de trabalho desse PC, abra o PowerShell nele e cole:</p>' + blocoCmd('cmd-atalho', LIGAR()) +
          '<p>Dois cliques no atalho liga; dois cliques de novo desliga.</p></div>' : '') +
        '<form class="passo" id="f-pc" novalidate><h3><i>+</i>Conectar um PC</h3>' +
        '<label class="campo"><span>Nome do PC</span><input name="nome" data-mask="upper" maxlength="40" placeholder="CASA, TRABALHO…"></label>' +
        '<p class="msg-form" id="msg-pc"></p><div class="acoes"><button class="btn btn-cor" type="submit">Gerar chave e instruções</button></div></form>',
        function (box) {
          if (window.Campos) Campos.aplicar(box);
          ligarCopiar(box);
          box.querySelectorAll('[data-baixa]').forEach(function (b) {
            b.onclick = function () {
              api('/agentes/' + b.dataset.baixa, { metodo: 'PATCH', corpo: { baixa_cortes: b.dataset.v === '1' } })
                .then(function () { abrirPCs(); carregar(); }).catch(function (e) { aviso(e.message, true); });
            };
          });
          box.querySelectorAll('[data-pasta-form]').forEach(function (f) {
            f.onsubmit = function (ev) {
              ev.preventDefault();
              var btn = f.querySelector('[type=submit]'), msg = f.querySelector('.msg-form');
              btn.disabled = true; msg.textContent = '';
              api('/agentes/' + f.dataset.pastaForm, { metodo: 'PATCH', corpo: { pasta: f.pasta.value } })
                .then(function () { aviso('Pasta salva. O PC passa a usar no próximo download.'); abrirPCs(); })
                .catch(function (e) { btn.disabled = false; msg.textContent = e.message; });
            };
          });
          box.querySelectorAll('[data-desligar]').forEach(function (b) {
            b.onclick = function () {
              confirmar('Desconectar o PC ' + b.dataset.nome + '? A chave dele para de valer na hora. Para voltar, gere uma chave nova.', 'Desconectar').then(function (sim) {
                if (!sim) return;
                api('/agentes/' + b.dataset.desligar, { metodo: 'DELETE' }).then(function () { aviso('PC desconectado.'); abrirPCs(); carregar(); })
                  .catch(function (e) { aviso(e.message, true); });
              });
            };
          });
          box.querySelector('#f-pc').onsubmit = function (ev) {
            ev.preventDefault();
            var nome = this.nome.value.trim(), msg = box.querySelector('#msg-pc'), btn = this.querySelector('[type=submit]');
            if (!nome) { msg.textContent = 'Dê um nome ao PC.'; return; }
            btn.disabled = true;
            api('/agentes', { metodo: 'POST', corpo: { nome: nome } }).then(function (r) { mostrarChave(r); carregar(); })
              .catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
          };
        });
    }).catch(function (e) { aviso(e.message, true); });
  }

  function mostrarChave(r) {
    var conectar = 'mkdir C:\\Cortex -Force | Out-Null; cd C:\\Cortex\n' +
      'Invoke-WebRequest -UseBasicParsing ' + PAINEL + '/projetos/cortex/agente/cortex-agente.mjs -OutFile cortex-agente.mjs\n' +
      'node cortex-agente.mjs conectar ' + PAINEL + ' ' + r.chave;
    var ligar = LIGAR();
    abrirGaveta('Conectar o PC ' + r.nome,
      '<p class="alerta">A chave deste PC aparece <b>só agora</b>. Faça os passos com esta tela aberta, <b>no próprio PC ' + esc(r.nome) + '</b>. Se perder, desconecte e gere outra.</p>' +
      '<div class="passo"><h3><i>1</i>Instalar os programas (só na primeira vez)</h3><p>Abra o <b>PowerShell</b> (menu Iniciar › digite PowerShell) e rode uma linha por vez. Depois <b>feche e abra o PowerShell de novo</b>.</p>' + blocoCmd('cmd1', INSTALAR) + '</div>' +
      '<div class="passo"><h3><i>2</i>Baixar o agente e conectar</h3><p>No PowerShell novo, cole tudo de uma vez:</p>' + blocoCmd('cmd2', conectar) +
      '<p>Deve aparecer <b>"Conectado! Este PC aparece no painel como ' + esc(r.nome) + '"</b>.</p></div>' +
      '<div class="passo"><h3><i>3</i>Criar o atalho de ligar e desligar</h3><p>No mesmo PowerShell, cole:</p>' + blocoCmd('cmd3', ligar) +
      '<p>Aparece na área de trabalho o atalho <b>Cortex - ligar e desligar</b>, e o Cortex já fica <b>ligado</b> (minimizado na barra de tarefas). Daqui pra frente:</p>' +
      '<p>• <b>Dois cliques no atalho</b> com ele desligado → liga.<br>• <b>Dois cliques de novo</b> → desliga. Se estiver baixando algo, o trabalho volta para a fila e nada se perde.<br>• Desligado, não roda nada no PC. O que você importar no painel espera até ligar.</p>' +
      '<p>Os cortes caem em <b>Vídeos › Cortex</b>, uma pasta por vídeo, com Longos, Curtos (sem layout) e Shorts (verticais legendados) separados e um .txt com título, descrição e tags ao lado de cada arquivo.</p></div>' +
      '<div class="acoes"><button class="btn" type="button" id="pc-voltar">Voltar para PCs</button></div>',
      function (box) { ligarCopiar(box); box.querySelector('#pc-voltar').onclick = abrirPCs; });
  }

  // ---------- início e atualização ----------
  carregar();
  // O PC trabalha sozinho: a cada 20 s o quadro se atualiza (só com a aba visível).
  setInterval(function () { if (!document.hidden && $('gaveta').hidden) carregar(); }, 30000);   // 19/11: 30 s (poupa o limite diário de leituras do D1)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
})();
