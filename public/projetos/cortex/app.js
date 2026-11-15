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
  $('form-link').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var campo = $('link'), btn = $('btn-importar'), msg = $('msg-link');
    var url = campo.value.trim();
    if (!url) { msg.textContent = 'Cole o link do vídeo.'; msg.className = 'ingest-msg erro'; campo.focus(); return; }
    btn.disabled = true; btn.textContent = 'Importando…';
    api('/videos', { metodo: 'POST', corpo: { url: url } }).then(function (r) {
      campo.value = ''; $('plat').dataset.p = ''; $('plat').textContent = 'LINK';
      msg.textContent = 'Importado. ' + (estado.pc.online ? 'O PC já vai buscar o texto.' : 'Quando o PC ligar, ele busca o texto.');
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
    if (x.tarefa_estado === 'pega') return '<div class="c-estado espera"><span class="ponto"></span>' + esc((x.tarefa_pc ? x.tarefa_pc + ': ' : '') + (x.tarefa_progresso || esperaTxt)) + '</div>';
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
  }

  function cartaoVideo(v) {
    var st = situacao(v, v.etapa === 'entrada' ? 'buscando o texto…' : v.etapa === 'roteiro' ? 'IA começando a ler…' : 'transcrevendo…');
    if (!st && v.etapa === 'roteiro') st = '<div class="c-estado espera"><span class="ponto"></span>Texto pronto: aguardando a IA (etapa 3)</div>';
    return '<button type="button" class="cartao' + (v.id === selVideo ? ' sel' : '') + '" data-video="' + v.id + '">' +
      '<div class="c-linha"><span class="tag-plat ' + v.plataforma + '">' + PLAT[v.plataforma] + '</span>' +
      (v.duracao_s ? '<span class="c-tc">' + tc(v.duracao_s) + '</span>' : '') + '</div>' +
      '<p class="c-titulo">' + esc(v.titulo || v.url.replace(/^https:\/\/(www\.)?/, '')) + '</p>' +
      (v.canal ? '<div class="c-sub">' + esc(v.canal) + '</div>' : '') + st + '</button>';
  }

  function cartaoCorte(c) {
    var acoes = '';
    if (c.estado === 'triagem') acoes = '<button type="button" class="mini sim" data-acao="download" data-corte="' + c.id + '">✓ Aprovar</button><button type="button" class="mini nao" data-acao="descartado" data-corte="' + c.id + '">✕ Descartar</button>';
    else if (c.estado === 'download' && c.erro) acoes = '<button type="button" class="mini sim" data-tentar-corte="' + c.id + '">↻ Tentar de novo</button><button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'download' && c.tarefa_estado !== 'pega') acoes = '<button type="button" class="mini nao" data-acao="triagem" data-corte="' + c.id + '">Cancelar</button>';
    else if (c.estado === 'edicao') acoes = '<button type="button" class="mini sim" data-acao="publicado" data-corte="' + c.id + '">✓ Publicado</button>';
    var st = c.estado === 'download' || c.erro ? situacao({ erro: c.erro, tarefa_estado: c.tarefa_estado, tarefa_pc: c.tarefa_pc, tarefa_progresso: c.tarefa_progresso, corte_fila: true }, 'baixando…') : '';
    return '<div role="button" tabindex="0" class="cartao ' + c.tipo + '" data-corte-abrir="' + c.id + '">' +
      '<div class="c-linha"><span class="tipo ' + c.tipo + '">' + (c.tipo === 'longo' ? 'LONGO' : 'CURTO') + '</span>' +
      '<span class="c-tc">' + tc(c.inicio_s) + '</span><span>' + duracao(c.fim_s - c.inicio_s) + '</span>' +
      (c.nota != null ? '<span class="nota" title="Potencial estimado pela IA">' + c.nota + '</span>' : '') + '</div>' +
      '<p class="c-titulo">' + esc(c.titulo) + '</p>' +
      '<div class="c-sub">' + esc(c.video_titulo || NOME_PLAT[c.plataforma]) + '</div>' + st +
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

  function mudarEstado(id, novo, botao) {
    if (botao) botao.disabled = true;
    return api('/cortes/' + id, { metodo: 'PATCH', corpo: { estado: novo } }).then(function () {
      aviso({ download: 'Aprovado: foi para a fila do PC.', descartado: 'Descartado.', triagem: 'Voltou para a triagem.', publicado: 'Marcado como publicado.', edicao: 'Voltou para a edição.' }[novo] || 'Feito.');
      return carregar();
    }).catch(function (e) { aviso(e.message, true); if (botao) botao.disabled = false; });
  }

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
      nome.textContent = 'Nenhum vídeo selecionado'; btn.hidden = true;
      corpo.innerHTML = '<p class="linha-vazia">Toque num vídeo do quadro para ver os cortes dele aqui.</p>';
      return;
    }
    var v = detalhe.video, cortes = detalhe.cortes;
    nome.textContent = (v.titulo || v.url) + (v.duracao_s ? '  ·  ' + tc(v.duracao_s) : '');
    nome.title = nome.textContent;
    btn.hidden = false;
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
    corpo.innerHTML =
      '<div class="tl"><div class="tl-cab"><div class="r">TC</div><div class="l">L</div><div class="c">C</div></div>' +
      '<div class="tl-area"><div class="regua" style="--passo:' + passoPct + '">' + marcas + '</div>' +
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
        '<dt>Etapa</dt><dd>' + etapas[v.etapa] + '</dd>' +
        '<dt>Importado</dt><dd>' + data(v.criado_em) + '</dd>' +
        (v.erro ? '<dt>Falha</dt><dd style="color:var(--perigo)">' + esc(v.erro) + '</dd>' : '') + '</dl>' +
        (v.erro ? '<div class="acoes"><button class="btn btn-ok" type="button" id="v-tentar">↻ Tentar de novo</button></div>' : '') +
        '<form class="bloco" id="f-video"><label class="campo"><span>Título</span><input name="titulo" maxlength="200" value="' + esc(v.titulo || '') + '" placeholder="O PC preenche com o título original"></label>' +
        '<p class="msg-form" id="msg-video"></p><div class="acoes"><button class="btn btn-cor" type="submit">Salvar</button>' +
        '<button class="btn" type="button" id="v-marcar">+ Marcar corte</button></div></form>' +
        '<div class="acoes"><button class="btn btn-fino esq" type="button" id="v-arquivar">Arquivar</button><button class="btn btn-perigo" type="button" id="v-excluir">Excluir vídeo</button></div>',
        function (box) {
          box.querySelector('#f-video').onsubmit = function (ev) {
            ev.preventDefault();
            var titulo = this.titulo.value.trim();
            api('/videos/' + v.id, { metodo: 'PATCH', corpo: { titulo: titulo } }).then(function () { aviso('Salvo.'); fecharGaveta(); carregar(); })
              .catch(function (e) { $('msg-video').textContent = e.message; });
          };
          box.querySelector('#v-marcar').onclick = function () { formCorte(null); };
          var vt = box.querySelector('#v-tentar');
          if (vt) vt.onclick = function () { tentar('videos', v.id, vt).then(fecharGaveta); };
          box.querySelector('#v-arquivar').onclick = function () {
            confirmar('Arquivar este vídeo? Ele e os cortes dele saem do quadro (nada é apagado).', 'Arquivar').then(function (sim) {
              if (!sim) return;
              api('/videos/' + v.id, { metodo: 'PATCH', corpo: { arquivado: true } }).then(function () {
                aviso('Arquivado.'); fecharGaveta(); selVideo = null; detalhe = null; desenharLinha(); carregar();
              }).catch(function (e) { aviso(e.message, true); });
            });
          };
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

  // Formulário de corte: novo (c = null) ou existente.
  function formCorte(c) {
    var v = detalhe.video, novo = !c;
    c = c || { tipo: 'curto', inicio_s: '', fim_s: '', titulo: '', descricao: '', tags: [], gancho: '', estado: 'triagem', origem: 'manual' };
    var tempoLivre = ['triagem', 'descartado'].indexOf(c.estado) >= 0;
    var nomes = { triagem: 'Triagem', download: 'Na fila do PC', edicao: 'Pronto para o Movavi', publicado: 'Publicado', descartado: 'Descartado' };
    var acoesEstado = '';
    if (!novo) {
      if (c.estado === 'triagem') acoesEstado = '<button class="btn btn-ok" type="button" data-ir="download">✓ Aprovar e baixar</button><button class="btn btn-fino" type="button" data-ir="descartado">Descartar</button>';
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
              (c.erro ? '<dt>Falha</dt><dd style="color:var(--perigo)">' + esc(c.erro) + '</dd>' : '') + '</dl>') +
      ia +
      (acoesEstado ? '<div class="acoes">' + acoesEstado + '</div>' : '') +
      '<form class="bloco" id="f-corte" novalidate>' +
      '<div class="campo"><span>Tipo</span><div class="escolha" id="esc-tipo"><button type="button" data-v="curto">Curto · 45-90 s</button><button type="button" data-v="longo">Longo · 30-40 min</button></div></div>' +
      '<div class="dupla"><label class="campo"><span>Início</span><input class="tc-campo" name="inicio" inputmode="numeric" placeholder="00:00:00" value="' + (c.inicio_s === '' ? '' : tc(c.inicio_s)) + '"' + (tempoLivre ? '' : ' disabled') + '></label>' +
      '<label class="campo"><span>Fim</span><input class="tc-campo" name="fim" inputmode="numeric" placeholder="00:00:00" value="' + (c.fim_s === '' ? '' : tc(c.fim_s)) + '"' + (tempoLivre ? '' : ' disabled') + '></label></div>' +
      '<p style="margin:-.2rem 0 0;font:.74rem var(--mono);color:var(--suave)" id="dur-corte"></p>' +
      '<label class="campo"><span>Título</span><input name="titulo" maxlength="150" value="' + esc(c.titulo) + '" placeholder="Título de alto clique"></label>' +
      '<label class="campo"><span>Gancho (primeiros segundos)</span><input name="gancho" maxlength="300" value="' + esc(c.gancho || '') + '" placeholder="A frase que segura quem está rolando o feed"></label>' +
      '<label class="campo"><span>Descrição</span><textarea name="descricao" maxlength="5000">' + esc(c.descricao || '') + '</textarea></label>' +
      '<label class="campo"><span>Tags (separadas por vírgula)</span><input name="tags" value="' + esc((c.tags || []).join(', ')) + '" placeholder="gta 6, trailer, rockstar"></label>' +
      '<p class="msg-form" id="msg-corte"></p>' +
      '<div class="acoes"><button class="btn btn-cor" type="submit">Salvar</button><button class="btn btn-fino" type="button" id="c-cancelar">Cancelar</button>' +
      (novo ? '' : '<button class="btn btn-perigo" type="button" id="c-excluir" style="margin-left:auto">Excluir</button>') + '</div></form>',
      function (box) {
        var f = box.querySelector('#f-corte'), tipo = c.tipo;
        function marcarTipo() { box.querySelectorAll('#esc-tipo button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === tipo); }); }
        marcarTipo();
        box.querySelector('#esc-tipo').onclick = function (ev) { var b = ev.target.closest('button'); if (b) { tipo = b.dataset.v; marcarTipo(); mostrarDur(); } };
        // máscara de timecode: só dígitos e ":", e completa os ":" ao sair do campo
        [f.inicio, f.fim].forEach(function (el) {
          el.addEventListener('input', function () { this.value = this.value.replace(/[^\d:]/g, '').slice(0, 8); mostrarDur(); });
          el.addEventListener('blur', function () { var s = lerTC(this.value); if (s != null) this.value = tc(s); });
        });
        function mostrarDur() {
          var a = lerTC(f.inicio.value), b = lerTC(f.fim.value), el = box.querySelector('#dur-corte');
          el.textContent = a != null && b != null && b > a ? 'Duração: ' + duracao(b - a) : '';
        }
        mostrarDur();
        box.querySelector('#c-cancelar').onclick = fecharGaveta;
        box.querySelectorAll('[data-ir]').forEach(function (b) {
          b.onclick = function () { mudarEstado(c.id, b.dataset.ir, b).then(function () { fecharGaveta(); }); };
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
          var corpo = { tipo: tipo, inicio_s: ini, fim_s: fim, titulo: f.titulo.value.trim(), gancho: f.gancho.value.trim(),
            descricao: f.descricao.value.trim(), tags: f.tags.value };
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
