// Tela do ClipStudio. Quem processa e o MOTOR (projetos/clipstudio/motor/, Python, no
// computador do dono): esta tela so envia a live, acompanha as etapas e mostra os cortes.
// O endereco do motor fica salvo neste navegador; os trabalhos ficam no motor, entao
// trocar de aparelho nao perde nada - e so apontar para o mesmo motor.
// Autoria: Claude (Opus 5.5).
(function () {
  var CHAVE_MOTOR = 'clipstudio.motor';
  var ETAPAS = [
    ['baixar', 'Baixar mídia'],
    ['audio', 'Extrair áudio'],
    ['transcrever', 'Transcrever (Groq Whisper)'],
    ['cortes', 'Escolher os melhores trechos (IA)'],
    ['renderizar', 'Gerar os clipes 9:16 com legenda'],
  ];
  var $ = function (id) { return document.getElementById(id); };
  var aba = 'url';
  var arquivo = null;
  var aberto = null;      // id do trabalho na tela
  var relogio = null;     // consulta periodica enquanto processa

  function motor() {
    var v = '';
    try { v = localStorage.getItem(CHAVE_MOTOR) || ''; } catch (_) {}
    return (v || 'http://localhost:8000').replace(/\/+$/, '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hms(seg) {
    seg = Math.max(0, Math.round(seg || 0));
    var h = Math.floor(seg / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;
    var mm = (h ? String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }

  function chamar(caminho, opcoes) {
    return fetch(motor() + caminho, opcoes).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.detail || ('O motor respondeu ' + r.status));
        return j;
      });
    }, function () {
      throw new Error('Não foi possível falar com o motor em ' + motor() + '. Ele está ligado?');
    });
  }

  // ------------------------------------------------------------ motor ligado?
  function conferirMotor() {
    var b = $('motor'), txt = $('motor-txt');
    chamar('/saude').then(function (s) {
      var falta = !s.groq ? 'sem chave da Groq' : !s.ffmpeg ? 'sem FFmpeg' : '';
      b.className = 'motor ' + (falta ? 'incompleto' : 'ligado');
      txt.textContent = falta ? 'Motor: ' + falta : 'Motor ligado';
    }).catch(function () {
      b.className = 'motor desligado';
      txt.textContent = 'Motor desligado';
    });
  }

  // ------------------------------------------------------------ entrada
  document.querySelector('.abas').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-aba]');
    if (!b) return;
    aba = b.dataset.aba;
    document.querySelectorAll('.abas button').forEach(function (x) { x.classList.toggle('ativa', x === b); });
    document.querySelectorAll('[data-painel]').forEach(function (p) { p.hidden = p.dataset.painel !== aba; });
    mensagem('');
  });

  function escolher(f) {
    arquivo = f || null;
    $('arquivo-nome').textContent = arquivo ? arquivo.name + ' (' + (arquivo.size / 1e6).toFixed(0) + ' MB)' : 'Escolha ou arraste o vídeo/áudio da live';
  }
  $('arquivo').addEventListener('change', function () { escolher(this.files[0]); });
  var soltar = $('soltar');
  ['dragenter', 'dragover'].forEach(function (ev) { soltar.addEventListener(ev, function (e) { e.preventDefault(); soltar.classList.add('sobre'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { soltar.addEventListener(ev, function (e) { e.preventDefault(); soltar.classList.remove('sobre'); }); });
  soltar.addEventListener('drop', function (e) { escolher(e.dataTransfer.files[0]); });

  function mensagem(t) { $('msg').textContent = t; $('msg').hidden = !t; }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    mensagem('');
    var pedido;
    if (aba === 'url') {
      var url = $('url').value.trim();
      if (!url) return mensagem('Cole o link do vídeo gravado da live.');
      if (!Campos.tudoValido($('form'))) return mensagem('Link inválido. Cole o endereço completo, começando com https://');
      pedido = chamar('/trabalhos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url }) });
    } else {
      if (!arquivo) return mensagem('Escolha o arquivo da live.');
      var fd = new FormData();
      fd.append('arquivo', arquivo);
      pedido = chamar('/trabalhos/arquivo', { method: 'POST', body: fd });
    }
    var botao = $('processar');
    botao.disabled = true;
    botao.textContent = aba === 'arquivo' ? 'Enviando arquivo...' : 'Enviando...';
    pedido.then(function (t) {
      $('url').value = '';
      escolher(null);
      abrir(t.id);
      carregarHistorico();
    }).catch(function (err) { mensagem(err.message); })
      .then(function () { botao.disabled = false; botao.textContent = 'Processar Live com IA'; });
  });

  // ------------------------------------------------------------ trabalho aberto
  function abrir(id) {
    aberto = id;
    // O endereco leva o trabalho aberto: recarregar a pagina ou guardar o link volta nele.
    try { history.replaceState(null, '', '#t=' + id); } catch (_) {}
    clearTimeout(relogio);
    $('trabalho').hidden = false;
    $('transcricao').hidden = true;
    $('transcricao').open = false;
    atualizarTrabalho();
    $('trabalho').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fechar() {
    aberto = null;
    clearTimeout(relogio);
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    $('trabalho').hidden = true;
    desenharCortes(null);
  }
  $('trab-fechar').onclick = fechar;

  function atualizarTrabalho() {
    var id = aberto;
    if (!id) return;
    chamar('/trabalhos/' + id).then(function (t) {
      if (aberto !== id) return;
      desenharTrabalho(t);
      if (t.situacao === 'na_fila' || t.situacao === 'processando') {
        relogio = setTimeout(atualizarTrabalho, 2000);
      } else {
        carregarHistorico();
      }
    }).catch(function (err) {
      if (aberto !== id) return;
      $('trab-sub').textContent = err.message;
      relogio = setTimeout(atualizarTrabalho, 5000);
    });
  }

  function desenharTrabalho(t) {
    $('trab-titulo').textContent = t.titulo || t.entrada;
    var sub = { na_fila: 'Na fila do motor', processando: 'Processando...', concluido: 'Concluído', erro: 'Parou com erro' }[t.situacao];
    if (t.duracao_seg) sub += ' · ' + hms(t.duracao_seg) + ' de live';
    $('trab-sub').textContent = sub;
    $('etapas').innerHTML = ETAPAS.map(function (e) {
      var s = t.etapas[e[0]] || { estado: 'pendente', detalhe: '' };
      var marca = s.estado === 'feito' ? '✓' : s.estado === 'erro' ? '!' : '';
      return '<li class="' + s.estado + '"><span class="sinal">' + marca + '</span><strong>' + e[1] + '</strong>' +
        (s.detalhe ? '<span class="det">' + esc(s.detalhe) + '</span>' : '') + '</li>';
    }).join('');
    if (t.etapas.transcrever && t.etapas.transcrever.estado === 'feito' && $('transcricao').hidden) carregarTranscricao(t.id);
    desenharCortes(t);
  }

  function carregarTranscricao(id) {
    chamar('/trabalhos/' + id + '/transcricao').then(function (tr) {
      if (aberto !== id) return;
      $('transcricao-txt').innerHTML = (tr.segmentos || []).map(function (s) {
        return '<p><span class="t">' + hms(s.inicio) + '</span>' + esc(s.texto) + '</p>';
      }).join('') || '<p>Transcrição vazia: o áudio não tem fala reconhecível.</p>';
      $('transcricao').hidden = false;
    }).catch(function () {});
  }

  // ------------------------------------------------------------ galeria
  function urlCorte(t, c) { return motor() + '/trabalhos/' + t.id + '/cortes/' + c.n; }

  function desenharCortes(t) {
    var g = $('galeria');
    var cortes = (t && t.cortes) || [];
    $('cortes-qtd').textContent = cortes.length ? cortes.length + (cortes.length === 1 ? ' corte' : ' cortes') : '';
    if (!t) {
      g.innerHTML = '<div class="vazio">Envie uma live acima, ou abra uma das lives processadas abaixo, para ver os cortes aqui.</div>';
      return;
    }
    if (!cortes.length) {
      var msg = t.situacao === 'concluido'
        ? 'Transcrição pronta. A escolha automática dos melhores trechos com IA é a próxima etapa do projeto.'
        : t.situacao === 'erro' ? 'Sem cortes: o processamento parou com erro.' : 'Os cortes aparecem aqui quando o processamento terminar.';
      g.innerHTML = '<div class="vazio">' + msg + '</div>';
      return;
    }
    cortes = cortes.slice().sort(function (a, b) { return (b.nota || 0) - (a.nota || 0); });
    g.innerHTML = cortes.map(function (c) {
      var src = urlCorte(t, c);
      return '<article class="corte">' +
        '<button type="button" class="capa" data-n="' + c.n + '" aria-label="Ver prévia">' +
        (c.arquivo ? '<video src="' + esc(src) + '#t=1" preload="metadata" muted playsinline></video>' : '') +
        '<span class="play">▶</span>' +
        '<span class="nota' + ((c.nota || 0) >= 80 ? ' alta' : '') + '">🔥 ' + (c.nota != null ? c.nota : '-') + '</span></button>' +
        '<div class="corpo"><h3>' + esc(c.titulo) + '</h3>' +
        (c.gancho ? '<p class="gancho">' + esc(c.gancho) + '</p>' : '') +
        '<span class="tempo">' + hms(c.inicio) + ' - ' + hms(c.fim) + ' · ' + hms(c.fim - c.inicio) + '</span></div>' +
        '<div class="acoes">' +
        (c.arquivo ? '<a href="' + esc(src) + '" download>Baixar</a>' : '<button type="button" disabled title="O clipe ainda não foi gerado">Baixar</button>') +
        '<button type="button" disabled title="Editor: em breve">Editar</button></div>' +
        '</article>';
    }).join('');
    g.onclick = function (e) {
      var b = e.target.closest('.capa');
      if (!b) return;
      var c = cortes.filter(function (x) { return String(x.n) === b.dataset.n; })[0];
      if (c) preview(t, c);
    };
  }

  // ------------------------------------------------------------ preview 9:16
  function preview(t, c) {
    $('modal-titulo').textContent = c.titulo;
    $('modal-gancho').textContent = c.gancho || '';
    var v = $('modal-video');
    var b = $('modal-baixar');
    if (c.arquivo) {
      v.src = urlCorte(t, c);
      b.href = v.src;
      b.hidden = false;
    } else {
      v.removeAttribute('src');
      b.hidden = true;
      $('modal-gancho').textContent = (c.gancho ? c.gancho + ' · ' : '') + 'O clipe deste trecho ainda não foi gerado.';
    }
    $('modal').hidden = false;
  }
  function fecharPreview() { var v = $('modal-video'); v.pause(); v.removeAttribute('src'); v.load(); $('modal').hidden = true; }
  $('modal-fechar').onclick = fecharPreview;
  $('modal').addEventListener('click', function (e) { if (e.target === this) fecharPreview(); });

  // ------------------------------------------------------------ historico
  function carregarHistorico() {
    var ul = $('historico');
    chamar('/trabalhos').then(function (r) {
      var lista = r.trabalhos || [];
      if (!lista.length) { ul.innerHTML = '<li class="vazio">Nenhuma live processada ainda.</li>'; return; }
      var rotulo = { na_fila: 'Na fila', processando: 'Processando', concluido: 'Concluído', erro: 'Erro' };
      ul.innerHTML = lista.map(function (t) {
        return '<li><button type="button" class="abrir-trab" data-id="' + t.id + '"><strong>' + esc(t.titulo || t.entrada) + '</strong>' +
          '<span>' + new Date(t.criado_em).toLocaleString('pt-BR') + (t.duracao_seg ? ' · ' + hms(t.duracao_seg) : '') + '</span></button>' +
          '<span class="etiqueta ' + t.situacao + '">' + rotulo[t.situacao] + '</span>' +
          '<button type="button" class="apagar" data-id="' + t.id + '">Apagar</button></li>';
      }).join('');
    }).catch(function (err) {
      ul.innerHTML = '<li class="vazio">' + esc(err.message) + '<br><button type="button" class="link" id="tentar">Tentar de novo</button></li>';
      $('tentar').onclick = function () { conferirMotor(); carregarHistorico(); };
    });
  }
  $('historico').addEventListener('click', function (e) {
    var a = e.target.closest('.abrir-trab');
    if (a) return abrir(a.dataset.id);
    var d = e.target.closest('.apagar');
    if (!d) return;
    if (!confirm('Apagar esta live processada? O vídeo, o áudio, a transcrição e os cortes dela saem do motor e não voltam.')) return;
    chamar('/trabalhos/' + d.dataset.id, { method: 'DELETE' }).then(function () {
      if (aberto === d.dataset.id) fechar();
      carregarHistorico();
    }).catch(function (err) { alert(err.message); });
  });
  $('atualizar').onclick = function () { conferirMotor(); carregarHistorico(); };

  // ------------------------------------------------------------ endereco do motor
  $('motor').onclick = function () { $('config-url').value = motor(); $('config').hidden = false; $('config-url').focus(); };
  function fecharConfig() { $('config').hidden = true; }
  document.querySelectorAll('#config [data-fecha]').forEach(function (b) { b.onclick = fecharConfig; });
  $('config').addEventListener('click', function (e) { if (e.target === this) fecharConfig(); });
  $('config-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('config-url').value.trim();
    if (v && !Campos.tudoValido(this)) return;
    try { if (v) localStorage.setItem(CHAVE_MOTOR, v); else localStorage.removeItem(CHAVE_MOTOR); } catch (_) {}
    fecharConfig();
    conferirMotor();
    carregarHistorico();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('modal').hidden) fecharPreview();
    if (!$('config').hidden) fecharConfig();
  });

  Campos.aplicar(document);
  desenharCortes(null);
  conferirMotor();
  carregarHistorico();
  function abrirDoLink() {
    var m = /^#t=([a-z0-9]{12})$/.exec(location.hash);
    if (m && m[1] !== aberto) abrir(m[1]);
  }
  window.addEventListener('hashchange', abrirDoLink);
  abrirDoLink();
})();
