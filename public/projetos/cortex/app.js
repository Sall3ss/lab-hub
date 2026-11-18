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
  var API = '/api/p/cortex';
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
  var estado = { videos: [], cortes: [], pc: { online: false } };
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
      estado = j; desenharPC(); desenharQuadro();
      if (selVideo) return carregarDetalhe(selVideo);
    }).catch(function (e) {
      if (!estado.videos.length && !estado.cortes.length) {
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
      var txt = !pc.total ? 'Conecte um PC para começar' : !pc.online ? 'Esperando um PC ligar' : 'Na fila do PC';
      if (x.corte_fila && pc.total && !pc.baixam) txt = 'Nenhum PC recebe downloads (ver PCs)';
      return '<div class="c-estado espera"><span class="ponto"></span>' + txt + '</div>';
    }
    return '';
  }

  function desenharQuadro() {
    var rolagem = quadroEl.scrollLeft, html = '', atalhos = '';
    COLUNAS.forEach(function (col, i) {
      var itens = col.grupo === 'video'
        ? estado.videos.filter(function (v) { return v.etapa === col.id; })
        : estado.cortes.filter(function (c) { return c.estado === col.id; });
      html += '<section class="coluna' + (i === 3 ? ' divisa' : '') + '" data-grupo="' + col.grupo + '" aria-label="' + esc(col.nome) + '">' +
        '<header class="col-topo"><span class="faixa">' + col.faixa + '</span><span class="col-nome">' + esc(col.nome) + '</span>' +
        '<span class="col-qtd">' + itens.length + '</span></header><div class="col-lista">' +
        (itens.length ? itens.map(col.grupo === 'video' ? cartaoVideo : cartaoCorte).join('') : '<p class="col-vazia">' + esc(VAZIO[col.id]) + '</p>') +
        '</div></section>';
      atalhos += '<button type="button" data-col="' + i + '">' + col.faixa + ' ' + esc(col.nome.split(' ')[0]) + '<b>' + itens.length + '</b></button>';
    });
    quadroEl.innerHTML = html;
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
      (v.ao_vivo_canal && v.capturado_ate_s ? '<div class="c-trecho" title="Até onde o texto foi capturado">⟳ capturado até ' + tc(v.capturado_ate_s) + '</div>' : '') +
      (textoTrecho(v) ? '<div class="c-trecho" title="Parte do vídeo analisada">⏱ ' + textoTrecho(v) + '</div>' : '') + st + '</button>';
  }

  function cartaoCorte(c) {
    var acoes = '';
    if (c.estado === 'triagem') acoes = '<button type="button" class="mini sim" data-acao="download" data-corte="' + c.id + '">✓ Aprovar</button>' +
      (c.tipo === 'longo' ? '<button type="button" class="mini fora" data-acao="edicao" data-corte="' + c.id + '" title="Aprova sem o PC baixar: você baixa por fora com o tempo">↗ Sem baixar</button>' : '') +
      '<button type="button" class="mini nao" data-acao="descartado" data-corte="' + c.id + '">✕ Descartar</button>';
    else if (c.estado === 'download' && c.erro) acoes = '<button type="button" class="mini sim" data-tentar-corte="' + c.id + '">↻ Tentar de novo</button><button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'download' && c.tarefa_estado !== 'pega') acoes = '<button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'edicao') acoes = '<button type="button" class="mini sim" data-acao="publicado" data-corte="' + c.id + '">✓ Publicado</button>';
    var st = c.estado === 'download' || c.erro ? situacao({ erro: c.erro, tarefa_estado: c.tarefa_estado, tarefa_pc: c.tarefa_pc, tarefa_progresso: c.tarefa_progresso, tarefa_atualizada: c.tarefa_atualizada, corte_fila: true }, 'baixando…') : '';
    return '<div role="button" tabindex="0" class="cartao ' + c.tipo + '" data-corte-abrir="' + c.id + '">' +
      '<div class="c-linha"><span class="tipo ' + c.tipo + '">' + (c.tipo === 'longo' ? 'LONGO' : 'CURTO') + '</span>' +
      '<span class="c-tc">' + tc(c.inicio_s) + '</span><span>' + duracao(c.fim_s - c.inicio_s) + '</span>' +
      (c.nota != null ? '<span class="nota" title="Potencial estimado pela IA">' + c.nota + '</span>' : '') + '</div>' +
      '<p class="c-titulo">' + esc(c.titulo) + '</p>' +
      '<div class="c-sub">' + esc(c.video_titulo || NOME_PLAT[c.plataforma]) + '</div>' +
      (c.baixar_fora && c.estado === 'edicao' ? '<div class="c-fora">↗ BAIXAR FORA · ' + tc(c.inicio_s) + ' → ' + tc(c.fim_s) + '</div>' : '') +
      (c.qualidade ? '<div class="c-qual" title="' + esc(c.qualidade) + '">▣ ' + esc(c.qualidade.split(' · ').slice(0, 2).join(' · ')) + '</div>' : '') + st +
      (acoes ? '<div class="c-acoes">' + acoes + '</div>' : '') + '</div>';
  }

  quadroEl.addEventListener('click', function (ev) {
    var tn = ev.target.closest('[data-tentar-corte]');
    if (tn) { ev.stopPropagation(); tentar('cortes', Number(tn.dataset.tentarCorte), tn); return; }
    var b = ev.target.closest('[data-acao]');
    if (b) { ev.stopPropagation(); mudarEstado(Number(b.dataset.corte), b.dataset.acao, b); return; }
    var v = ev.target.closest('[data-video]');
    if (v) { selecionar(Number(v.dataset.video)); abrirVideo(); return; }
    var c = ev.target.closest('[data-corte-abrir]');
    if (c) abrirCorte(Number(c.dataset.corteAbrir), true);
  });
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
      aviso(novo === 'edicao' && antes === 'triagem' ? 'Aprovado sem baixar: o tempo para copiar está na C3 Edição.'
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
  function podePuxar(v) {
    return !!(v && v.ao_vivo_canal && v.capturado_ate_s && v.continuar_de_s == null && (v.etapa === 'roteiro' || v.etapa === 'cortado'));
  }
  function puxarResto(v, botao, msgEl) {
    botao.disabled = true;
    return api('/videos/' + v.id + '/continuar', { metodo: 'POST' }).then(function () {
      aviso(estado.pc.online ? 'Puxando o resto: o PC já vai buscar a parte nova.' : 'Na fila: quando o PC ligar, ele busca a parte nova.');
      fecharGaveta(); detalhe = null; carregar().then(function () { if (selVideo) carregarDetalhe(selVideo); });
    }).catch(function (e) { botao.disabled = false; if (msgEl) msgEl.textContent = e.message; else aviso(e.message, true); });
  }
  $('btn-resto').addEventListener('click', function () { if (detalhe) puxarResto(detalhe.video, this); });
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
    if (podePuxar(v)) $('btn-resto').textContent = '⟳ Puxar o resto (de ' + tc(v.capturado_ate_s) + ')';
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

  function abrirVideo() {
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
          ? '<div class="bloco"><div class="acoes"><button class="btn btn-ok" type="button" id="v-resto">⟳ Puxar o resto (de ' + tc(v.capturado_ate_s) + ' em diante)</button></div>' +
            '<p class="dica-trecho">Pega o que a live andou desde a última captura: o PC busca só a parte nova e a IA lê só ela. Os cortes que você já tem ficam.</p>' +
            '<p class="msg-form" id="msg-resto"></p></div>' : '') +
        '<form class="bloco" id="f-video"><label class="campo"><span>Título</span><input name="titulo" maxlength="200" value="' + esc(v.titulo || '') + '" placeholder="O PC preenche com o título original"></label>' +
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
            var titulo = this.titulo.value.trim();
            api('/videos/' + v.id, { metodo: 'PATCH', corpo: { titulo: titulo } }).then(function () { aviso('Salvo.'); fecharGaveta(); carregar(); })
              .catch(function (e) { $('msg-video').textContent = e.message; });
          };
          box.querySelector('#v-marcar').onclick = function () { formCorte(null); };
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
          if (vr) vr.onclick = function () { puxarResto(v, vr, $('msg-resto')); };
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
    var textos = c.titulo + '\n\n' + (c.descricao || '') + ((c.tags || []).length ? '\n\n' + c.tags.map(function (t) { return '#' + t.replace(/\s+/g, ''); }).join(' ') : '');
    return '<div class="caixa-fora"><b>BAIXAR FORA DO CORTEX</b>' +
      linha('Início', tc(c.inicio_s), true) + linha('Fim', tc(c.fim_s), true) +
      linha('Duração', duracao(c.fim_s - c.inicio_s), true) +
      (c.gancho_inicio_s != null ? linha('Gancho', tc(c.gancho_inicio_s - c.inicio_s) + ' → ' + tc(c.gancho_fim_s - c.inicio_s), true) : '') +
      linha('Vídeo', v.url, false) +
      '<div class="fora-acoes"><a class="btn btn-cor" href="https://kick-video.download" target="_blank" rel="noopener">Abrir kick-video.download ↗</a>' +
      '<button type="button" class="btn btn-fino" data-copia="' + esc(textos) + '">Copiar título, descrição e tags</button></div></div>';
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
    var ia = c.origem === 'ia' && (c.motivo || c.nota != null)
      ? '<div class="caixa-ia"><b>LEITURA DA IA' + (c.nota != null ? ' · POTENCIAL ' + c.nota + '/100' : '') + '</b>' + esc(c.motivo || '') + '</div>' : '';
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
      '<div class="dupla"><label class="campo"><span>Início</span><input class="tc-campo" name="inicio" inputmode="numeric" placeholder="00:00:00" value="' + (c.inicio_s === '' ? '' : tc(c.inicio_s)) + '"' + (tempoLivre ? '' : ' disabled') + '>' + ajustes('inicio', tempoLivre) + '</label>' +
      '<label class="campo"><span>Fim</span><input class="tc-campo" name="fim" inputmode="numeric" placeholder="00:00:00" value="' + (c.fim_s === '' ? '' : tc(c.fim_s)) + '"' + (tempoLivre ? '' : ' disabled') + '>' + ajustes('fim', tempoLivre) + '</label></div>' +
      (c.estado === 'edicao' ? '<p style="margin:-.2rem 0 0;font-size:.78rem;color:var(--suave)">' + (fora ? 'Sem arquivo no PC: ajuste o tempo e aperte <b>Salvar</b>.' : 'Mudou o tempo? Use <b>Baixar de novo</b>: o PC baixa com o tempo novo.') + '</p>' : '') +
      '<p style="margin:-.2rem 0 0;font:.74rem var(--mono);color:var(--suave)" id="dur-corte"></p>' +
      '<label class="campo"><span>Título</span><input name="titulo" maxlength="150" value="' + esc(c.titulo) + '" placeholder="Título de alto clique"></label>' +
      '<label class="campo"><span>Gancho (primeiros segundos)</span><input name="gancho" maxlength="300" value="' + esc(c.gancho || '') + '" placeholder="A frase que segura quem está rolando o feed"></label>' +
      // 15/11: onde o gancho é dito (tempo do vídeo original); abaixo, o tempo dentro do arquivo do corte.
      '<div class="dupla"><label class="campo"><span>Gancho começa</span><input class="tc-campo" name="g_inicio" inputmode="numeric" placeholder="00:00:00" value="' + (c.gancho_inicio_s == null ? '' : tc(c.gancho_inicio_s)) + '">' + ajustes('g_inicio', true, 1) + '</label>' +
      '<label class="campo"><span>Gancho termina</span><input class="tc-campo" name="g_fim" inputmode="numeric" placeholder="00:00:00" value="' + (c.gancho_fim_s == null ? '' : tc(c.gancho_fim_s)) + '">' + ajustes('g_fim', true, 1) + '</label></div>' +
      '<p class="dica-gancho" id="dica-gancho"></p>' +
      '<label class="campo"><span>Descrição</span><textarea name="descricao" maxlength="5000">' + esc(c.descricao || '') + '</textarea></label>' +
      '<label class="campo"><span>Tags (separadas por vírgula)</span><input name="tags" value="' + esc((c.tags || []).join(', ')) + '" placeholder="gta 6, trailer, rockstar"></label>' +
      '<p class="msg-form" id="msg-corte"></p>' +
      '<div class="acoes"><button class="btn btn-cor" type="submit">Salvar</button><button class="btn btn-fino" type="button" id="c-cancelar">Cancelar</button>' +
      (novo ? '' : '<button class="btn btn-perigo" type="button" id="c-excluir" style="margin-left:auto">Excluir</button>') + '</div></form>',
      function (box) {
        var f = box.querySelector('#f-corte'), tipo = c.tipo;
        box.querySelectorAll('[data-copia]').forEach(function (b) { b.onclick = function () { copiar(b, b.dataset.copia); }; });
        function marcarTipo() { box.querySelectorAll('#esc-tipo button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === tipo); }); }
        marcarTipo();
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
          else d.textContent = 'No arquivo do corte (Movavi): ' + tc(gi - a) + ' → ' + tc(gf - a) + ' · ' + duracao(gf - gi);
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
                descricao: f.descricao.value.trim(), tags: f.tags.value }, tg);
            }
            mudarEstado(c.id, b.dataset.ir, b, extra).then(function (ok) { if (ok) fecharGaveta(); });
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
            descricao: f.descricao.value.trim(), tags: f.tags.value }, tg);
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
      '<p>Os cortes caem em <b>Vídeos › Cortex</b>, uma pasta por vídeo, com Curtos e Longos separados e um .txt com título, descrição e tags ao lado de cada arquivo.</p></div>' +
      '<div class="acoes"><button class="btn" type="button" id="pc-voltar">Voltar para PCs</button></div>',
      function (box) { ligarCopiar(box); box.querySelector('#pc-voltar').onclick = abrirPCs; });
  }

  // ---------- início e atualização ----------
  carregar();
  // O PC trabalha sozinho: a cada 20 s o quadro se atualiza (só com a aba visível).
  setInterval(function () { if (!document.hidden && $('gaveta').hidden) carregar(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
})();
