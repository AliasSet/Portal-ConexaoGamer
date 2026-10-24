/**
 * cms-components.js - blocos extras do editor de matérias (Decap CMS).
 *
 * Aparecem no botão "+" da barra de ferramentas do editor:
 *   - Imagem com legenda
 *   - Vídeo do YouTube
 *   - Post ou perfil de rede social (X, Instagram, TikTok, YouTube, Twitch, Facebook)
 *
 * No texto da matéria, cada bloco vira uma linha no formato  [[tipo|campo|campo|...]]
 * O build.js (arquivo embeds.js) transforma essa linha no HTML final do site.
 * O build.js já carrega este arquivo sozinho no painel: não precisa mexer em admin/index.html.
 */
(function () {
  if (typeof CMS === 'undefined') {
    console.warn('[cms-components] CMS não encontrado: este arquivo precisa carregar depois do Decap CMS.');
    return;
  }

  // O separador do atalho é "|" e o fim é "]]": troca esses caracteres se alguém digitar na legenda
  var clean = function (s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\|/g, '¦').replace(/\]\]/g, '] ]').trim();
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var box = 'border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:8px 0;font-family:sans-serif;';

  /* ---------- Imagem com legenda ---------- */
  CMS.registerEditorComponent({
    id: 'figura',
    label: 'Imagem com legenda',
    fields: [
      { name: 'imagem', label: 'Imagem', widget: 'image' },
      { name: 'legenda', label: 'Legenda (aparece abaixo da imagem)', widget: 'string', required: false,
        hint: 'Ex.: Imagem: Divulgação/Alliance Arts' },
      { name: 'alt', label: 'Texto alternativo (descreve a imagem para leitores de tela e Google)', widget: 'string', required: false,
        hint: 'Se deixar em branco, usa a legenda.' },
      { name: 'tamanho', label: 'Tamanho', widget: 'select', default: 'media',
        options: [
          { label: 'Pequena (360 px, centralizada)', value: 'pequena' },
          { label: 'Média (600 px, centralizada)', value: 'media' },
          { label: 'Grande (largura total do texto)', value: 'grande' }
        ] }
    ],
    pattern: /^\[\[imagem\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) {
      return { imagem: m[1], tamanho: m[2] || 'media', legenda: m[3], alt: m[4] };
    },
    toBlock: function (o) {
      return '[[imagem|' + clean(o.imagem) + '|' + (o.tamanho || 'media') + '|' + clean(o.legenda) + '|' + clean(o.alt) + ']]';
    },
    toPreview: function (o, getAsset, fields) {
      var src = o.imagem || '';
      try {
        var f = fields && fields.find(function (x) { return x.get('widget') === 'image'; });
        src = String(getAsset(o.imagem, f)) || src;
      } catch (e) { /* usa o caminho cru */ }
      var w = { pequena: '360px', media: '600px', grande: '100%' }[o.tamanho] || '600px';
      return '<figure style="max-width:' + w + ';margin:16px auto;text-align:center">' +
        '<img src="' + esc(src) + '" alt="' + esc(o.alt || o.legenda) + '" style="max-width:100%;border-radius:8px">' +
        (o.legenda ? '<figcaption style="font-size:13px;color:#6b7280;margin-top:6px">' + esc(o.legenda) + '</figcaption>' : '') +
        '</figure>';
    }
  });

  /* ---------- Vídeo do YouTube ---------- */
  CMS.registerEditorComponent({
    id: 'video_youtube',
    label: 'Vídeo do YouTube',
    fields: [
      { name: 'url', label: 'Link do vídeo', widget: 'string',
        hint: 'Cole o endereço do vídeo (youtube.com/watch?v=… ou youtu.be/…). Se o link tiver o tempo (&t=90), o vídeo começa nele.' },
      { name: 'legenda', label: 'Legenda (opcional)', widget: 'string', required: false }
    ],
    pattern: /^\[\[youtube\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) { return { url: m[1], legenda: m[2] }; },
    toBlock: function (o) { return '[[youtube|' + clean(o.url) + '|' + clean(o.legenda) + ']]'; },
    toPreview: function (o) {
      return '<div style="' + box + 'background:#111827;color:#fff;text-align:center">▶ Vídeo do YouTube<br>' +
        '<small style="color:#9ca3af;word-break:break-all">' + esc(o.url) + '</small>' +
        (o.legenda ? '<br><small style="color:#9ca3af">' + esc(o.legenda) + '</small>' : '') + '</div>';
    }
  });

  /* ---------- Post ou perfil de rede social ---------- */
  CMS.registerEditorComponent({
    id: 'rede_social',
    label: 'Post ou perfil de rede social',
    fields: [
      { name: 'url', label: 'Link do post ou do perfil', widget: 'string',
        hint: 'Post do X, Instagram ou TikTok: aparece o post completo. Perfil (ex.: x.com/usuario): aparece um cartão com botão para seguir. Outros links viram um cartão simples.' },
      { name: 'legenda', label: 'Legenda (opcional)', widget: 'string', required: false }
    ],
    pattern: /^\[\[social\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) { return { url: m[1], legenda: m[2] }; },
    toBlock: function (o) { return '[[social|' + clean(o.url) + '|' + clean(o.legenda) + ']]'; },
    toPreview: function (o) {
      return '<div style="' + box + 'background:#111827;color:#fff;text-align:center">Rede social<br>' +
        '<small style="color:#9ca3af;word-break:break-all">' + esc(o.url) + '</small>' +
        (o.legenda ? '<br><small style="color:#9ca3af">' + esc(o.legenda) + '</small>' : '') + '</div>';
    }
  });

  /* =====================================================================
   * Painel de checagem ao vivo (aba "Pré-visualização" do editor de Notícias e Reviews)
   * Avalia título, resumo, imagem de capa e texto enquanto você escreve.
   * Só AVISA: nunca impede de salvar ou publicar.
   * ===================================================================== */
  var SITE_NAME = 'Conexão Gamer';
  var SITE_HOST = 'conexaogamer.com.br';
  var OWN_HOST = /(^|\.)conexaogamer\.com\.br$|(^|\.)vercel\.app$|(^|\.)supabase\.co$/i;

  function slugify(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Mesma regra do site (seoTitle no build.js): "Título | Conexão Gamer" se couber em 70; senão só o título; senão corta.
  function googleTitle(t) {
    t = String(t || '').trim();
    var full = t + ' | ' + SITE_NAME;
    if (full.length <= 70) return full;
    if (t.length <= 70) return t;
    return t.slice(0, 69).replace(/\s+\S*$/, '').replace(/[\s,;:\-–—]+$/, '') + '…';
  }

  function countWords(body) {
    var t = String(body || '')
      .replace(/\[\[[^\]]*\]\]/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~\-]+/g, ' ');
    var m = t.match(/\S+/g);
    return m ? m.length : 0;
  }

  // Cada item: { g: grupo, l: 'ok'|'warn'|'bad'|'info', t: texto curto, d: explicação }
  function analyze(d, img) {
    var out = [];
    function add(g, l, t, dd) { out.push({ g: g, l: l, t: t, d: dd || '' }); }
    var title = String(d.title || '').trim();
    var summary = String(d.summary || '').trim();
    var G1 = 'Título e resumo', G2 = 'Imagem de capa', G3 = 'Texto', G4 = 'Classificação';

    // --- Título
    if (!title) add(G1, 'bad', 'Sem título', 'Escreva o título da matéria.');
    else {
      var n = title.length;
      if (n < 25) add(G1, 'warn', 'Título curto (' + n + ' caracteres)', 'Títulos de 40 a 70 caracteres costumam funcionar melhor na busca.');
      else if (n > 70) add(G1, 'warn', 'Título longo (' + n + ' caracteres)', 'O Google corta perto de 70. A página mostra o título inteiro, mas na busca ele aparece cortado. Se der, deixe o fim menos importante.');
      else add(G1, 'ok', 'Título com bom tamanho (' + n + ' caracteres)', '');
      var letters = title.replace(/[^A-Za-zÀ-ÿ]/g, '');
      var upper = title.replace(/[^A-ZÀ-Þ]/g, '');
      if (letters.length > 12 && upper.length / letters.length > 0.6) add(G1, 'warn', 'Título quase todo em MAIÚSCULAS', 'Passa impressão de sensacionalismo e o Google pode reescrever.');
      if (/[!?]{2,}|!.*!/.test(title)) add(G1, 'warn', 'Muitas exclamações ou interrogações no título', 'Prefira um título direto e informativo.');
    }

    // --- Resumo
    if (!summary) add(G1, 'bad', 'Sem resumo', 'O resumo vira a descrição que aparece no Google.');
    else {
      var s = summary.length;
      if (s < 90) add(G1, 'warn', 'Resumo curto (' + s + ' caracteres)', 'Use de 120 a 160 caracteres para aproveitar o espaço no Google.');
      else if (s > 160) add(G1, 'warn', 'Resumo longo (' + s + ' caracteres)', 'O Google mostra uns 160. O resto é cortado.');
      else add(G1, 'ok', 'Resumo com bom tamanho (' + s + ' caracteres)', '');
      if (title && summary.toLowerCase() === title.toLowerCase()) add(G1, 'warn', 'Resumo igual ao título', 'Use o resumo para acrescentar informação nova.');
    }

    // --- Imagem
    var path = String(d.image || '').trim();
    if (!path) add(G2, 'bad', 'Sem imagem de capa', 'A capa aparece nos cards, no Google Discover e nas redes sociais.');
    else {
      if (/^https?:\/\//i.test(path)) {
        var host = '';
        try { host = new URL(path).hostname; } catch (e) {}
        if (host && !OWN_HOST.test(host)) add(G2, 'warn', 'Capa hospedada em outro site (' + host + ')', 'Pode quebrar ou bloquear, e a imagem pode ter dono. O ideal é enviar a imagem pelo painel.');
        else add(G2, 'ok', 'Capa hospedada no seu site', '');
      } else add(G2, 'ok', 'Capa enviada pelo painel', '');

      if (img.status === 'loading') add(G2, 'info', 'Medindo a imagem…', '');
      else if (img.status === 'error') add(G2, 'warn', 'Não consegui abrir a imagem', 'Confira o arquivo ou o endereço. Se acabou de enviar, aguarde alguns segundos.');
      else if (img.status === 'ok') {
        if (img.w >= 1200) add(G2, 'ok', 'Largura de ' + img.w + ' px (ideal para o Google Discover)', '');
        else if (img.w >= 800) add(G2, 'warn', 'Largura de ' + img.w + ' px', 'O Google Discover pede pelo menos 1200 px de largura para mostrar a imagem grande.');
        else add(G2, 'bad', 'Imagem pequena (' + img.w + ' px de largura)', 'Use uma imagem com pelo menos 1200 px de largura.');
        if (img.h && img.w / img.h < 1.2) add(G2, 'info', 'Imagem vertical ou quadrada', 'Nos cards e nas redes sociais, imagens horizontais (como 16:9) ficam melhores.');
        if (img.bytes) {
          var kb = Math.round(img.bytes / 1024);
          if (img.bytes > 1572864) add(G2, 'warn', 'Imagem pesada (' + (img.bytes / 1048576).toFixed(1).replace('.', ',') + ' MB)', 'Deixa o site lento. Reduza ou comprima antes de enviar (WebP ou JPG de 200 a 500 KB costuma bastar).');
          else if (img.bytes > 614400) add(G2, 'info', 'Imagem com ' + kb + ' KB', 'Dá para comprimir mais sem perder qualidade visível.');
          else add(G2, 'ok', 'Peso da imagem leve (' + kb + ' KB)', '');
        }
      }
      if (!String(d.image_caption || '').trim()) add(G2, 'warn', 'Sem legenda ou crédito da imagem', 'Informe a fonte, por exemplo "Imagem: Divulgação/Estúdio".');
      else add(G2, 'ok', 'Legenda/crédito preenchido', '');
    }

    // --- Texto
    var body = String(d.body || '');
    var words = countWords(body);
    if (words < 100) add(G3, 'bad', 'Texto muito curto (' + words + ' palavras)', 'Notícias com menos de 100 palavras rendem pouco na busca.');
    else if (words < 300) add(G3, 'warn', 'Texto curto (' + words + ' palavras)', 'Matérias a partir de uns 300 palavras costumam ter melhor desempenho.');
    else add(G3, 'ok', 'Tamanho do texto bom (' + words + ' palavras)', '');
    if (words >= 400 && !/^#{2,3}\s/m.test(body)) add(G3, 'warn', 'Texto longo sem subtítulos', 'Use "## Subtítulo" para dividir. Ajuda quem lê e o Google.');
    if (!/\]\(\s*(\/(noticias|categoria)\/|https?:\/\/(www\.)?conexaogamer\.com\.br|https?:\/\/[^)\s]*vercel\.app\/)/i.test(body)) add(G3, 'warn', 'Nenhum link para outra matéria do site', 'O fim da matéria já tem links automáticos, mas links no meio do texto valem mais: veja "Matérias para linkar no texto" logo abaixo.');
    else add(G3, 'ok', 'Tem link para outra matéria do site', '');
    // imagens dentro do texto sem descrição
    var semAlt = 0, total = 0, m;
    var reMd = /!\[([^\]]*)\]\([^)]*\)/g;
    while ((m = reMd.exec(body))) { total++; if (!m[1].trim()) semAlt++; }
    var reFig = /\[\[imagem\|([^\]]*)\]\]/g;
    while ((m = reFig.exec(body))) { total++; var a = m[1].split('|'); if (!(a[2] || '').trim() && !(a[3] || '').trim()) semAlt++; }
    if (total && semAlt) add(G3, 'warn', semAlt + ' imagem(ns) do texto sem legenda ou descrição', 'Na caixa "Imagem com legenda", preencha a legenda ou o texto alternativo.');
    else if (total) add(G3, 'ok', 'Imagens do texto com descrição', '');

    // --- Classificação
    var cats = d.category; if (typeof cats === 'string') cats = [cats];
    cats = (cats || []).filter(Boolean);
    if (!cats.length) add(G4, 'bad', 'Sem categoria', 'Escolha ao menos uma categoria: é ela que coloca a matéria nas páginas de seção.');
    else add(G4, 'ok', 'Categoria: ' + cats.join(', '), '');
    if (!String(d.author || '').trim()) add(G4, 'warn', 'Sem autor', 'Escolha o autor: o Google valoriza matérias assinadas.');
    else add(G4, 'ok', 'Autor: ' + d.author, '');
    var tags = (d.tags || []).filter(Boolean);
    if (tags.length < 2) add(G4, 'info', 'Poucas tags (' + tags.length + ')', 'Duas ou três tags ajudam a mostrar matérias relacionadas.');
    else add(G4, 'ok', tags.length + ' tags', '');
    if (cats.indexOf('Reviews') !== -1 && (d.rating === undefined || d.rating === null || d.rating === '')) add(G4, 'warn', 'Review sem nota', 'Preencha "Nota do Review (0-10)".');
    return out;
  }

  var COLORS = {
    ok: { ico: '✅', c: '#15803d' }, warn: { ico: '⚠️', c: '#b45309' },
    bad: { ico: '❌', c: '#b91c1c' }, info: { ico: 'ℹ️', c: '#4b5563' }
  };

  if (typeof window.createClass !== 'function' || typeof window.h !== 'function') {
    console.warn('[cms-components] createClass/h não encontrados: o painel de checagem não foi carregado.');
  } else {
    var h = window.h, createClass = window.createClass;
    var E = function (tag, style) {
      return h.apply(null, [tag, { style: style || {} }].concat([].slice.call(arguments, 2)));
    };

    // ---------- Sugestões de links internos ----------
    // Endereço do site (a prévia roda dentro de um iframe, onde location.origin pode vir "null")
    function siteOrigin() {
      try { if (window.origin && window.origin !== 'null') return window.origin; } catch (e) {}
      try { return window.parent.location.origin; } catch (e) {}
      return '';
    }
    var STOP = {}; ('para com uma uns umas dos das nos nas que mais como mas por sobre entre após apos ate até desde sem sob ' +
      'seu sua seus suas ele ela eles elas isso esse essa esses essas este esta estes estas aqui ali foi ser são sao tem têm ' +
      'ter está estao estão vai vão pode podem será serao quando onde qual quais cujo cuja também tambem ainda já muito ' +
      'muitos muita muitas novo nova novos novas segundo diz disse após depois antes durante contra todo toda todos todas ' +
      'seja sendo havia haver fazer faz feito ano anos dia dias vez vezes outro outra outros outras mesmo mesma tudo nada').split(' ').forEach(function (w) { STOP[w] = 1; });
    function norm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    function words(t) {
      var out = {}; (norm(t).match(/[a-z0-9]+/g) || []).forEach(function (w) { if (w.length >= 4 && !STOP[w]) out[w] = 1; });
      return out;
    }

    // Matérias já publicadas que combinam com a que está sendo escrita. Pesos: tag em comum 4; palavra do título
    // em comum 3; palavra do texto aparecendo no título da outra 1,5; mesma categoria 1 ("Notícias" 0,3).
    function suggest(d, posts) {
      var title = norm(d.title).trim();
      var wTitle = words(d.title), wBody = words(String(d.body || '').replace(/\[\[[^\]]*\]\]/g, ' '));
      var myTags = {}; (d.tags || []).forEach(function (t) { var k = norm(t).trim(); if (k) myTags[k] = 1; });
      var myCats = {}; (Array.isArray(d.category) ? d.category : (d.category ? [d.category] : [])).forEach(function (c) { myCats[c] = 1; });
      var res = [];
      (posts || []).forEach(function (q) {
        if (!q || !q.url || !q.title || norm(q.title).trim() === title) return;
        var qw = words(q.title), score = 0, why = [];
        Object.keys(qw).forEach(function (w) {
          if (wTitle[w]) { score += 3; why.push(w); }
          else if (wBody[w]) { score += 1.5; why.push(w); }
        });
        (q.tags || []).forEach(function (t) { var k = norm(t).trim(); if (myTags[k]) { score += 4; why.unshift(String(t)); } });
        (q.categories || []).forEach(function (c) { if (myCats[c]) score += (c === 'Notícias' ? 0.3 : 1); });
        if (score >= 3) res.push({ q: q, score: score, why: why.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3) });
      });
      res.sort(function (a, b) { return (b.score - a.score) || ((b.q.time || 0) - (a.q.time || 0)); });
      return res.slice(0, 5);
    }

    function copyText(t) {
      var fallback = function () {
        try {
          var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
        } catch (e) { return false; }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
      } catch (e) {}
      return Promise.resolve(fallback());
    }

    // Formatos reais em que a capa aparece no site (medidas do layout em tela de 1280 px e de celular).
    // pct = largura relativa à coluna principal (805 px) só para caber no painel; a PROPORÇÃO é a real.
    var FORMATS = [
      { n: 'Destaque principal (computador)', pct: 100, w: 805, h: 480, ov: 'title' },
      { n: 'Destaque lateral (computador)', pct: 49, w: 395, h: 232, ov: 'title' },
      { n: 'Card da lista (computador)', pct: 49, w: 390, h: 192, ov: 'chips' },
      { n: 'Dentro da matéria (computador)', pct: 100, w: 805, h: 'auto', ov: null },
      { n: 'Matérias relacionadas', pct: 32, w: 258, h: 112, ov: null },
      { n: 'Destaque principal (celular)', pct: 44, w: 358, h: 420, ov: 'title' },
      { n: 'Card da lista (celular)', pct: 44, w: 358, h: 192, ov: 'chips' },
      { n: 'Compartilhamento (WhatsApp, X, Facebook)', pct: 62, w: 1200, h: 630, ov: null, center: true }
    ];

    function cropSection(src, info, title, cats, focus) {
      var label = { fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', margin: '0 0 8px' };
      if (!src) {
        return E('div', { background: '#0b0f19', borderRadius: '10px', padding: '14px 16px', margin: '0 0 18px', color: '#9ca3af', fontSize: '13px', fontFamily: 'system-ui, sans-serif' },
          E('div', label, 'Prévia dos cortes da capa'), 'Escolha a imagem de capa para ver como ela fica em cada lugar do site.');
      }
      var known = info && info.status === 'ok' && info.w && info.h;
      var r = known ? info.w / info.h : null;
      var cards = FORMATS.map(function (f) {
        var t = f.h === 'auto' ? Math.max(r || 1.917, 805 / 420) : f.w / f.h;   // na matéria, a altura máxima é 420 px
        var note = '', warn = false;
        if (f.center) note = 'Redes sociais sempre cortam no centro. ';
        if (known) {
          if (r > t * 1.01) { var vw = Math.round(t / r * 100); note += 'Mostra ' + vw + '% da largura (corta as laterais)'; warn = vw < 80; }
          else if (r < t / 1.01) { var vh = Math.round(r / t * 100); note += 'Mostra ' + vh + '% da altura (corta em cima e embaixo)'; warn = vh < 80; }
          else note += 'Aparece inteira';
        }
        var box = { position: 'relative', overflow: 'hidden', borderRadius: '10px', border: '1px solid #1f2937', background: '#111827', aspectRatio: String(t) };
        var kids = [h('img', { key: 'i', src: src, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: f.center ? '50% 50%' : focus } })];
        if (f.ov === 'title') {
          kids.push(h('div', { key: 'o', style: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(3,7,18,.97), rgba(3,7,18,.6) 45%, rgba(3,7,18,0))', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '8%' } },
            h('div', { style: { color: '#fff', fontWeight: 800, fontSize: f.pct >= 100 ? '15px' : '11px', lineHeight: 1.25, maxHeight: '3.8em', overflow: 'hidden' } }, title || 'Título da matéria')));
        } else if (f.ov === 'chips') {
          kids.push(h('span', { key: 'c', style: { position: 'absolute', top: '8px', left: '8px', background: 'rgba(8,51,68,.85)', color: '#67e8f9', border: '1px solid rgba(34,211,238,.4)', borderRadius: '4px', fontSize: '9px', fontWeight: 700, padding: '1px 6px', textTransform: 'uppercase' } }, (cats && cats[0]) || 'Notícias'));
        }
        return E('div', { width: 'calc(' + f.pct + '% - 6px)', minWidth: '120px' },
          h.apply(null, ['div', { style: box }].concat(kids)),
          E('div', { fontSize: '11px', color: '#e5e7eb', marginTop: '4px', fontWeight: 700 }, f.n),
          note ? E('div', { fontSize: '11px', color: warn ? '#fbbf24' : '#9ca3af' }, (warn ? '⚠️ ' : '') + note) : null
        );
      });
      return E('div', { background: '#0b0f19', borderRadius: '10px', padding: '14px 16px', margin: '0 0 18px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
        E('div', label, 'Prévia dos cortes da capa (como aparece no site)'),
        E('div', { fontSize: '12px', color: '#9ca3af', marginBottom: '10px', lineHeight: 1.4 }, 'O site corta o que passa do quadro, mantendo visível o ponto de foco (campos "Foco da imagem" acima; sem escolher, é o centro). Foco atual: ' + focus + '. Deixe o assunto principal longe das bordas.' + (known ? ' Proporção da sua imagem: ' + (Math.round(r * 100) / 100).toString().replace('.', ',') + ':1.' : '')),
        h.apply(null, ['div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px 8px', alignItems: 'flex-start' } }].concat(cards))
      );
    }

    var Checker = createClass({
      getInitialState: function () { return { img: { status: 'none' }, posts: null, copied: '' }; },
      componentDidMount: function () {
        this._dead = false; this.measure();
        var self = this;
        try {
          fetch(siteOrigin() + '/posts.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (list) { if (!self._dead) self.setState({ posts: Array.isArray(list) ? list : 'erro' }); })
            .catch(function () { if (!self._dead) self.setState({ posts: 'erro' }); });
        } catch (e) { this.setState({ posts: 'erro' }); }
      },
      copyLink: function (q) {
        var self = this, md = '[' + q.title + '](' + q.url + ')';
        copyText(md).then(function (ok) {
          if (self._dead) return;
          self.setState({ copied: ok ? q.url : '' });
          setTimeout(function () { if (!self._dead && self.state.copied === q.url) self.setState({ copied: '' }); }, 2500);
        });
      },
      componentDidUpdate: function () { this.measure(); },
      componentWillUnmount: function () { this._dead = true; },

      imgSrc: function () {
        var path = this.props.entry.getIn(['data', 'image']);
        if (!path) return '';
        if (/^(https?:|data:|blob:)/i.test(path)) return path;
        try {
          var f = this.props.fields && this.props.fields.find(function (x) { return x.get('name') === 'image'; });
          var u = String(this.props.getAsset(path, f) || '');
          if (u) return u;
        } catch (e) { /* usa o caminho cru */ }
        return path.charAt(0) === '/' ? siteOrigin() + path : path;
      },

      measure: function () {
        var self = this, src = this.imgSrc();
        if (src === this._measured) return;
        this._measured = src;
        if (!src) { this.setState({ img: { status: 'none' } }); return; }
        this.setState({ img: { status: 'loading' } });
        var im = new Image();
        im.onload = function () {
          if (self._dead || self._measured !== src) return;
          var info = { status: 'ok', w: im.naturalWidth, h: im.naturalHeight, bytes: null };
          self.setState({ img: info });
          try {   // o peso só é conhecido para imagens enviadas pelo painel ou de sites que permitem a leitura
            fetch(src).then(function (r) { return r.blob(); }).then(function (b) {
              if (self._dead || self._measured !== src) return;
              self.setState({ img: { status: 'ok', w: info.w, h: info.h, bytes: b.size } });
            }).catch(function () {});
          } catch (e) {}
        };
        im.onerror = function () {
          if (self._dead || self._measured !== src) return;
          self.setState({ img: { status: 'error' } });
        };
        im.src = src;
      },

      render: function () {
        var entry = this.props.entry;
        var d = (entry.get('data') && entry.get('data').toJS) ? entry.get('data').toJS() : {};
        var checks = analyze(d, this.state.img);
        var bad = checks.filter(function (c) { return c.l === 'bad'; }).length;
        var warn = checks.filter(function (c) { return c.l === 'warn'; }).length;
        var head, headColor;
        if (!bad && !warn) { head = '✅ Tudo certo para publicar'; headColor = '#15803d'; }
        else if (!bad) { head = '⚠️ Quase lá: ' + warn + ' ajuste(s) sugerido(s)'; headColor = '#b45309'; }
        else { head = '❌ Faltam ' + bad + ' item(ns) importante(s)' + (warn ? ' e ' + warn + ' ajuste(s)' : ''); headColor = '#b91c1c'; }

        var groups = [], seen = {};
        checks.forEach(function (c) { if (!seen[c.g]) { seen[c.g] = []; groups.push(c.g); } seen[c.g].push(c); });

        var title = String(d.title || '').trim();
        var slug = slugify(title).slice(0, 60) || 'titulo-da-materia';
        var gTitle = googleTitle(title || 'Título da matéria');
        var gDesc = String(d.summary || '').trim();
        if (gDesc.length > 160) gDesc = gDesc.slice(0, 159).replace(/\s+\S*$/, '') + '…';

        var font = { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#111827' };
        var headEl = E('div', { fontWeight: 800, fontSize: '16px', color: headColor, marginBottom: '10px' }, head);
        var googleBox = E('div', { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' },
          E('div', { fontSize: '11px', color: '#6b7280', marginBottom: '4px' }, 'Como deve aparecer no Google'),
          E('div', { fontSize: '12px', color: '#4d5156' }, SITE_HOST + ' › noticias › ' + slug),
          E('div', { fontSize: '18px', color: '#1a0dab', lineHeight: 1.3, margin: '2px 0' }, gTitle),
          E('div', { fontSize: '13px', color: '#4d5156', lineHeight: 1.45 }, gDesc || 'O resumo da matéria aparece aqui.')
        );

        var blocks = groups.map(function (g) {
          var rows = seen[g].map(function (c) {
            var k = COLORS[c.l];
            return E('div', { display: 'flex', gap: '8px', padding: '3px 0', fontSize: '13px', lineHeight: 1.4 },
              E('span', { flexShrink: 0 }, k.ico),
              E('span', {}, E('span', { color: k.c, fontWeight: 700 }, c.t), c.d ? E('span', { color: '#4b5563' }, ' ' + c.d) : null)
            );
          });
          return E.apply(null, ['div', { marginTop: '8px' }, E('div', { fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6b7280', margin: '6px 0 2px' }, g)].concat(rows));
        });

        var src = this.imgSrc();
        var article = E('div', font,
          E('div', { fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6b7280', margin: '0 0 8px' }, 'Prévia da matéria'),
          E('h1', { fontSize: '28px', lineHeight: 1.2, margin: '0 0 12px' }, title || 'Título da matéria'),
          src ? E('figure', { margin: '0 0 16px' },
            h('img', { src: src, alt: '', style: { maxWidth: '100%', borderRadius: '10px', display: 'block' } }),
            d.image_caption ? E('figcaption', { fontSize: '12px', color: '#6b7280', marginTop: '6px' }, d.image_caption) : null
          ) : null,
          E('div', { fontSize: '16px', lineHeight: 1.65 }, this.props.widgetFor('body'))
        );

        var panelStyle = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px 16px', margin: '0 0 18px', fontFamily: font.fontFamily };
        var panel = h.apply(null, ['div', { style: panelStyle }, headEl, googleBox].concat(blocks));
        var self = this, sg = null;
        var sgStyle = { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px 16px', margin: '0 0 18px', fontFamily: font.fontFamily, fontSize: '13px', lineHeight: 1.45 };
        var sgTitle = E('div', { fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6b7280', margin: '0 0 6px' }, 'Matérias para linkar no texto');
        var sgHelp = E('div', { color: '#4b5563', marginBottom: '8px' }, 'Links no meio do texto ajudam o Google e o leitor. Clique em "Copiar link", volte ao editor e cole no ponto certo (troque o texto entre colchetes por uma palavra que descreva o assunto).');
        if (this.state.posts === null) sg = E('div', sgStyle, sgTitle, 'Carregando as matérias do site…');
        else if (this.state.posts === 'erro') sg = E('div', sgStyle, sgTitle, 'Não consegui carregar a lista de matérias do site (/posts.json). Verifique a conexão ou tente novamente.');
        else {
          var found = suggest(d, this.state.posts);
          if (!found.length) sg = E('div', sgStyle, sgTitle, 'Ainda não achei matéria parecida. Preencha o título, as tags e o texto para eu sugerir.');
          else {
            var rows = found.map(function (f) {
              var q = f.q, done = self.state.copied === q.url;
              return E('div', { display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', borderTop: '1px solid #e5e7eb' },
                E('div', { flex: 1, minWidth: 0 },
                  E('div', { fontWeight: 700, color: '#111827' }, q.title),
                  E('div', { fontSize: '11px', color: '#6b7280' }, (q.categories && q.categories[0] || 'Notícias') + (f.why.length ? ' · em comum: ' + f.why.join(', ') : '') + ' · ' + q.url)
                ),
                h('button', { type: 'button', onClick: function () { self.copyLink(q); }, style: { flexShrink: 0, cursor: 'pointer', border: '1px solid ' + (done ? '#15803d' : '#d1d5db'), background: done ? '#dcfce7' : '#fff', color: done ? '#15803d' : '#111827', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', fontWeight: 700 } }, done ? 'Copiado!' : 'Copiar link')
              );
            });
            sg = h.apply(null, ['div', { style: sgStyle }, sgTitle, sgHelp].concat(rows));
          }
        }
        var catList = d.category; if (typeof catList === 'string') catList = [catList];
        var fx = /^\d{1,3}%$/.test(String(d.focus_x || '')) ? d.focus_x : '50%';
        var fy = /^\d{1,3}%$/.test(String(d.focus_y || '')) ? d.focus_y : '50%';
        var crops = cropSection(src, this.state.img, title, catList || [], fx + ' ' + fy);
        return E('div', { padding: '4px' }, panel, sg, crops, article);
      }
    });

    CMS.registerPreviewTemplate('posts', Checker);
    window.__cgAnalyze = analyze; window.__cgSuggest = suggest;   // usado nos testes
  }

})();
