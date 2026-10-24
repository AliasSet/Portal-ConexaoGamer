/**
 * build.js - roda na Vercel a cada deploy (buildCommand em vercel.json).
 *
 * O que faz:
 *  1. Lê os posts em content/posts/*.md (criados pelo Decap CMS)
 *  2. Gera uma página HTML por matéria em dist/noticias/<slug>/index.html
 *     (mesmo layout do site: cabeçalho, barra lateral e rodapé)
 *  3. Gera dist/posts.json (usado pela home e pela barra lateral)
 *  4. Gera dist/index.html (home), sitemap.xml e robots.txt
 *  5. Copia admin/ (para o endereço ADMIN_PATH) e uploads/ para dist/
 *
 * Layout do site = index.html (modelo). As partes trocadas em cada página
 * ficam entre os marcadores <!--CG:HEAD-->, <!--CG:HERO--> e <!--CG:MAIN-->.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { renderBody, embedExtras } = require('./embeds');   // imagens com legenda, YouTube e redes sociais

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const AUTHORS_DIR = path.join(ROOT, 'content', 'authors');
const SITE_NAME = 'Conexão Gamer';
// Vercel Web Analytics: o script só coleta depois que você liga "Web Analytics" no painel da Vercel.
// Para desligar o script do site sem mexer na Vercel, crie a variável ANALYTICS=off.
const ANALYTICS = String(process.env.ANALYTICS || '').toLowerCase() !== 'off';

// Endereço do painel do CMS (Decap). A pasta do repositório continua sendo admin/;
// só o endereço publicado muda. Para trocar: altere o texto abaixo (só letras minúsculas,
// números e hífen) OU crie a variável ADMIN_PATH na Vercel. O antigo /admin/ deixa de existir.
const ADMIN_PATH = String(process.env.ADMIN_PATH || 'cg-gestao-7q4').replace(/^\/+|\/+$/g, '');
if (!/^[a-z0-9][a-z0-9-]*$/.test(ADMIN_PATH) || ADMIN_PATH === 'api') {
  throw new Error('ADMIN_PATH inválido: use só letras minúsculas, números e hífen (ex.: cg-gestao-7q4)');
}
// Troque pelo domínio definitivo (ou defina a variável SITE_URL na Vercel)
const SITE_URL = (process.env.SITE_URL || 'https://conexaogamer-seven.vercel.app').replace(/\/+$/, '');

/**
 * CATEGORIAS DO SITE
 * - CATEGORY_ALIASES: nomes antigos usados em posts já publicados -> nome atual
 * - CATEGORIES: páginas /categoria/<slug>/ . "match" = categorias do CMS que entram na página.
 *   (A página "Consoles" reúne PlayStation + Xbox + Nintendo.)
 */
const CATEGORY_ALIASES = { 'PC Games': 'PC' };

const CATEGORIES = [
  { slug: 'noticias', name: 'Notícias', tag: 'Notícias', match: ['Notícias'], desc: 'As últimas notícias do mundo dos games e da tecnologia.' },
  // "PC" reúne a tag PC + Steam + Epic Games
  { slug: 'pc', name: 'PC', tag: 'PC', match: ['PC', 'Steam', 'Epic Games'], desc: 'Lançamentos, guias, códigos e novidades dos jogos de PC, da Steam e da Epic Games.' },
  // "Consoles" reúne a tag Consoles + as tags de cada console
  { slug: 'consoles', name: 'Consoles', tag: 'Consoles', match: ['Consoles', 'PlayStation', 'Xbox', 'Nintendo'], desc: 'Tudo sobre PlayStation, Xbox e Nintendo.' },
  { slug: 'playstation', name: 'PlayStation', tag: 'PlayStation', match: ['PlayStation'], desc: 'Notícias e lançamentos do universo PlayStation.' },
  { slug: 'xbox', name: 'Xbox', tag: 'Xbox', match: ['Xbox'], desc: 'Notícias e lançamentos do universo Xbox.' },
  { slug: 'nintendo', name: 'Nintendo', tag: 'Nintendo', match: ['Nintendo'], desc: 'Notícias e lançamentos do universo Nintendo.' },
  { slug: 'steam', name: 'Steam', tag: 'Steam', match: ['Steam'], desc: 'Novidades, promoções e lançamentos da Steam.' },
  { slug: 'epic-games', name: 'Epic Games', tag: 'Epic Games', match: ['Epic Games'], desc: 'Jogos grátis, novidades e lançamentos da Epic Games Store.' },
  { slug: 'hardware', name: 'Hardware', tag: 'Hardware', match: ['Hardware'], desc: 'Placas de vídeo, processadores, periféricos e tecnologia para games.' },
  { slug: 'reviews', name: 'Reviews', tag: 'Reviews', match: ['Reviews'], desc: 'Análises e notas dos jogos e produtos que testamos.' }
];
const catSlug = (name) => {
  const c = CATEGORIES.find((x) => x.tag === name);
  return c ? c.slug : null;
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Utilidades ---------- */

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Lê a data digitada no painel. Aceita:
//  - data já pronta do YAML (Date) ou ISO (2026-10-07T21:12:00.000Z)
//  - formato brasileiro do painel: 07/10/2026T21:12, 07/10/2026 21:12 ou só 07/10/2026
// Datas sem fuso (as brasileiras) são lidas como horário de Brasília (UTC-3).
// Devolve 0 se não entender (aí o build usa a data do nome do arquivo e avisa no log).
function parsePostDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
  if (v == null || v === '') return 0;
  const str = String(v).trim();
  const br = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = br;
    const t = Date.UTC(+y, +mo - 1, +d, +h + 3, +mi, +se);   // +3h: Brasília -> UTC
    const chk = new Date(t - 3 * 3600 * 1000);                  // confere se o dia existe (ex.: 31/02)
    return (chk.getUTCDate() === +d && chk.getUTCMonth() === +mo - 1) ? t : 0;
  }
  const iso = str.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/);   // ISO sem fuso -> Brasília
  const t = Date.parse(iso ? str.replace(' ', 'T') + '-03:00' : str);
  return isNaN(t) ? 0 : t;
}

function fileDate(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getTime() : 0;
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v)];
}

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE_URL + u;
  return '';
}

const okImg = (u) => /^(https?:)?\/\//i.test(u || '') || String(u || '').startsWith('/');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

function fmtDateLong(ms) {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

/* ---------- Autores (painel: Autores) ---------- */

const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Lê content/authors/*.md. A matéria guarda só o NOME do autor; aqui buscamos foto e bio pelo nome.
function loadAuthors() {
  const map = new Map();
  if (!fs.existsSync(AUTHORS_DIR)) return map;
  for (const f of fs.readdirSync(AUTHORS_DIR).filter((n) => /\.md$/i.test(n))) {
    try {
      const text = fs.readFileSync(path.join(AUTHORS_DIR, f), 'utf8').replace(/^\uFEFF/, '');
      const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
      if (!m) throw new Error('sem frontmatter');
      const meta = yaml.load(m[1]) || {};
      const name = String(meta.name || '').replace(/\s+/g, ' ').trim();
      if (!name) throw new Error('autor sem nome');
      const photo = meta.photo ? String(meta.photo).trim() : '';
      map.set(normName(name), {
        name,
        photo: okImg(photo) ? photo : '',
        bio: String(meta.bio || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      });
    } catch (e) {
      console.warn('[build] AVISO: autor ignorado (' + f + '): ' + e.message);
    }
  }
  return map;
}

// Junta ao post a foto e a bio do autor (se o nome bater com um autor cadastrado)
function attachAuthors(posts, authors) {
  for (const p of posts) {
    const a = authors.get(normName(p.author));
    p.authorPhoto = a ? a.photo : '';
    p.authorBio = a ? a.bio : '';
    p.authorKnown = !!a;
    if (a) p.author = a.name;   // usa a grafia cadastrada
  }
}

// Foto redonda do autor (se a imagem falhar, some e sobra o ícone/nome)
const authorImg = (p, size) => p.authorPhoto
  ? `<img src="${esc(p.authorPhoto)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${size} rounded-full object-cover border border-gray-700 flex-shrink-0" onerror="this.remove()">`
  : '';

/* ---------- Leitura dos posts ---------- */

function parsePost(fileName, text, mdParse) {
  const m = text.replace(/^\uFEFF/, '')
    .match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) throw new Error('sem frontmatter (bloco --- no topo do arquivo)');

  const meta = yaml.load(m[1]) || {};
  const body = (m[2] || '').trim();

  let time = parsePostDate(meta.date);
  if (!time) {
    if (meta.date) console.warn('[build] AVISO: data não entendida em ' + fileName + ' (' + JSON.stringify(meta.date) + '); usando a data do nome do arquivo.');
    time = fileDate(fileName);
  }

  const rating = Number(meta.rating);
  const words = body.split(/\s+/).filter(Boolean).length;

  return {
    file: fileName,
    title: String(meta.title || 'Sem título').replace(/\s+/g, ' ').trim(),
    summary: String(meta.summary || '').replace(/\s+/g, ' ').trim(),
    image: meta.image ? String(meta.image) : '',
    imageCaption: meta.image_caption ? String(meta.image_caption).replace(/\s+/g, ' ').trim() : '',
    categories: toList(meta.category).map((c) => CATEGORY_ALIASES[c] || c),
    tags: toList(meta.tags),
    rating: meta.rating != null && meta.rating !== '' && isFinite(rating) ? rating : null,
    author: meta.author ? String(meta.author) : 'Redação Conexão Gamer',
    time,
    readMin: Math.max(1, Math.round(words / 200)),
    html: renderBody(body, mdParse)
  };
}

function loadPosts(mdParse) {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const posts = [];
  for (const f of fs.readdirSync(POSTS_DIR).filter((n) => /\.md$/i.test(n))) {
    try {
      posts.push(parsePost(f, fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'), mdParse));
    } catch (e) {
      // Um post com erro NÃO derruba o site: é ignorado e aparece no log do deploy
      console.warn('[build] AVISO: post ignorado (' + f + '): ' + e.message);
    }
  }
  posts.sort((a, b) => (b.time - a.time) || b.file.localeCompare(a.file));

  // URL estável a partir do NOME DO ARQUIVO (sem a data), sem acentos, e única
  const used = new Set();
  for (const p of posts) {
    let base = slugify(p.file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')) || 'materia';
    if (base.length > 90) base = base.slice(0, 90).replace(/-[^-]*$/, '') || base.slice(0, 90);
    let slug = base, n = 2;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    p.slug = slug;
    p.url = '/noticias/' + slug + '/';
  }
  return posts;
}

/* ---------- HTML das páginas ---------- */

function catStyle(c) {
  return ({
    'PC': 'bg-cyan-900/80 text-cyan-300 border-cyan-500/40',
    'PlayStation': 'bg-indigo-900/80 text-indigo-300 border-indigo-500/40',
    'Xbox': 'bg-green-900/80 text-green-300 border-green-500/40',
    'Nintendo': 'bg-red-900/80 text-red-300 border-red-500/40',
    'Reviews': 'bg-amber-900/80 text-amber-300 border-amber-500/40',
    'Hardware': 'bg-purple-900/80 text-purple-300 border-purple-500/40',
    'Consoles': 'bg-fuchsia-900/80 text-fuchsia-300 border-fuchsia-500/40',
    'Notícias': 'bg-sky-900/80 text-sky-300 border-sky-500/40',
    'Steam': 'bg-slate-700/80 text-slate-200 border-slate-400/40',
    'Epic Games': 'bg-teal-900/80 text-teal-300 border-teal-500/40'
  })[c] || 'bg-gray-800/90 text-gray-300 border-gray-600/40';
}

/**
 * Primeira linha do texto, logo abaixo da imagem de capa.
 * Se a primeira linha for CURTA e sem ponto final, ela não é um parágrafo comum:
 *  - começa com "Imagem:", "Foto:", "Fonte:", "Crédito:"...  -> legenda pequena sob a imagem
 *  - qualquer outra (ex.: a manchete repetida no texto)      -> ESCONDIDA (o título já aparece no topo)
 * O campo "Legenda / crédito da imagem" do CMS, se preenchido, sempre vira a legenda.
 * Para ter um título/intertítulo de verdade no início do texto, use "## Título" (isso não é escondido).
 */
const CREDIT_RE = /^(imagem|imagens|foto|fotos|fonte|crédito|créditos|reprodução|divulgação|arte|ilustração|captura)\b/i;

function splitCaption(p) {
  let html = p.html;
  let caption = p.imageCaption ? esc(p.imageCaption) : '';
  const m = html.match(/^\s*<p>([\s\S]*?)<\/p>\s*/);
  if (m) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    const shortLine = text && text.length <= 160 && !/[.…:]["')»”]*$/.test(text);
    if (shortLine) {
      const rest = html.slice(m[0].length);
      if (CREDIT_RE.test(text)) {
        if (!caption && okImg(p.image)) { caption = m[1]; html = rest; }
      } else {
        html = rest;
      }
    }
  }
  return { html, caption };
}

/* ---------- Compartilhar e "Leia também" ---------- */

const SHARE_BTN_BASE = 'items-center justify-center w-9 h-9 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 hover:text-cyan-400 hover:border-cyan-400 transition text-sm';
const SHARE_BTN = 'inline-flex ' + SHARE_BTN_BASE;

// Barra de compartilhamento: links simples (sem rastreadores). "where" = 'top' ou 'bottom'.
function shareHtml(p, where) {
  const url = SITE_URL + p.url;
  const u = encodeURIComponent(url), t = encodeURIComponent(p.title);
  const links = [
    ['WhatsApp', 'fa-brands fa-whatsapp', `https://wa.me/?text=${encodeURIComponent(p.title + ' ' + url)}`],
    ['Telegram', 'fa-brands fa-telegram', `https://t.me/share/url?url=${u}&text=${t}`],
    ['X (Twitter)', 'fa-brands fa-twitter', `https://x.com/intent/post?text=${t}&url=${u}`],
    ['Facebook', 'fa-brands fa-facebook-f', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['Reddit', 'fa-brands fa-reddit-alien', `https://www.reddit.com/submit?url=${u}&title=${t}`]
  ].map(([name, icon, href]) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Compartilhar no ${esc(name)}" title="${esc(name)}" class="${SHARE_BTN}"><i class="${icon}"></i></a>`).join('');
  const label = where === 'top' ? 'Compartilhar' : 'Gostou? Compartilhe';
  return `<div class="cg-share flex flex-wrap items-center gap-2 ${where === 'top' ? 'mt-4' : 'mt-8'}" data-url="${esc(url)}" data-title="${esc(p.title)}">
                        <span class="text-[11px] uppercase tracking-widest text-gray-500 font-extrabold mr-1"><i class="fa-solid fa-share-nodes text-cyan-400 mr-1"></i>${label}</span>
                        ${links}
                        <button type="button" data-cg-copy aria-label="Copiar link" title="Copiar link" class="${SHARE_BTN}"><i class="fa-solid fa-link"></i></button>
                        <button type="button" data-cg-native aria-label="Compartilhar pelo celular" title="Mais opções" class="hidden ${SHARE_BTN_BASE}"><i class="fa-solid fa-ellipsis"></i></button>
                        ${where === 'top' ? `<button type="button" id="save-btn" aria-pressed="false" title="Salvar para ler depois" class="ml-auto inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 hover:text-cyan-400 hover:border-cyan-400 transition text-xs font-bold"><i class="fa-regular fa-bookmark"></i><span>Salvar</span></button>` : ''}
                    </div>`;
}

// Só uma vez por página: copiar link e o botão de compartilhar nativo do celular
const SHARE_SCRIPT = `<script>
(function () {
    var bars = document.querySelectorAll('.cg-share');
    // botão do celular: só em aparelho de toque que sabe compartilhar
    if (navigator.share && window.matchMedia && matchMedia('(pointer: coarse)').matches) bars.forEach(function (b) { var n = b.querySelector('[data-cg-native]'); if (n) { n.classList.remove('hidden'); n.classList.add('inline-flex'); } });
    function done(msg) { if (window.cgToast) cgToast(msg); }
    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta); return ok;
    }
    document.addEventListener('click', function (e) {
        var copy = e.target.closest && e.target.closest('[data-cg-copy]');
        var nat = e.target.closest && e.target.closest('[data-cg-native]');
        var bar = (copy || nat) && (copy || nat).closest('.cg-share');
        if (!bar) return;
        var url = bar.getAttribute('data-url'), title = bar.getAttribute('data-title');
        if (nat) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () { done('Link copiado!'); }, function () { done(fallbackCopy(url) ? 'Link copiado!' : 'Não consegui copiar. Copie o endereço pelo navegador.'); });
        } else { done(fallbackCopy(url) ? 'Link copiado!' : 'Não consegui copiar. Copie o endereço pelo navegador.'); }
    });
})();
</script>`;

// "Leia também": 3 matérias parecidas (tags em comum pesam mais; "Notícias" é genérica e pesa pouco).
// Se faltar parecida, completa com as mais recentes.
function relatedPosts(p, posts, n) {
  const tagSet = new Set(p.tags.map(normName));
  const score = (q) => {
    let sc = 0;
    for (const t of q.tags) if (tagSet.has(normName(t))) sc += 3;
    for (const c of q.categories) if (p.categories.includes(c)) sc += (c === 'Notícias' ? 0.5 : 2);
    return sc;
  };
  const others = posts.filter((q) => q.slug !== p.slug).map((q) => ({ q, sc: score(q) }));
  others.sort((a, b) => (b.sc - a.sc) || (Math.abs(a.q.time - p.time) - Math.abs(b.q.time - p.time)));
  return others.slice(0, n).map((x) => x.q);
}

function relatedCardHtml(q) {
  const cat = (q.categories[0] || 'Notícias');
  return `<a href="${esc(q.url)}" class="group bg-gray-900 border border-gray-800 rounded-xl overflow-hidden card-hover flex flex-col">
                                <div class="relative h-28 overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950">
                                    ${okImg(q.image) ? `<img src="${esc(q.image)}" alt="${esc(q.title)}" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.style.display='none'">` : ''}
                                    <span class="absolute top-2 left-2 border text-[10px] font-bold px-2 py-0.5 rounded uppercase ${catStyle(cat)}">${esc(cat)}</span>
                                </div>
                                <div class="p-3 flex flex-col flex-grow">
                                    <h3 class="text-sm font-bold text-white group-hover:text-cyan-300 transition line-clamp-3">${esc(q.title)}</h3>
                                    <p class="mt-auto pt-2 text-[11px] text-gray-500">${esc(fmtDateShort(q.time))}</p>
                                </div>
                            </a>`;
}

function relatedHtml(list) {
  if (!list || !list.length) return '';
  return `<section class="mt-10 pt-8 border-t border-gray-800" aria-label="Leia também">
                        <h2 class="text-lg font-black text-white flex items-center gap-2"><i class="fa-solid fa-book-open text-cyan-400"></i> Leia também</h2>
                        <div class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                            ${list.map(relatedCardHtml).join('\n                            ')}
                        </div>
                    </section>`;
}

function articleHtml(p, related) {
  const { html: bodyHtml, caption } = splitCaption(p);
  const cats = p.categories.map((c) => {
    const cls = `text-[10px] border px-2.5 py-0.5 rounded font-bold uppercase ${catStyle(c)}`;
    const slug = catSlug(c);
    return slug
      ? `<a href="/categoria/${slug}/" class="${cls} hover:brightness-125 transition">${esc(c)}</a>`
      : `<span class="${cls}">${esc(c)}</span>`;
  }).join(' ');
  const tags = p.tags.map((t) =>
    `<span class="text-[11px] text-gray-400 bg-gray-900 border border-gray-800 rounded-full px-3 py-1"># ${esc(t)}</span>`).join(' ');

  return `
                <article class="pb-8">
                    <div class="flex flex-wrap items-center gap-2 mb-3">${cats}${p.rating != null ? `<span class="bg-cyan-400 text-black font-black text-xs px-2 py-0.5 rounded">NOTA ${esc(p.rating)}</span>` : ''}</div>
                    <h1 class="text-3xl sm:text-4xl font-black text-white leading-tight">${esc(p.title)}</h1>
                    ${p.summary ? `<p class="text-gray-400 mt-3">${esc(p.summary)}</p>` : ''}
                    <div class="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 pb-4 border-b border-gray-800 text-xs text-gray-400">
                        <span class="inline-flex items-center gap-1.5">${p.authorPhoto ? authorImg(p, 'w-6 h-6') : '<i class="fa-solid fa-user text-cyan-400"></i>'} ${esc(p.author)}</span>
                        <span><i class="fa-regular fa-calendar text-cyan-400 mr-1"></i> <time datetime="${new Date(p.time).toISOString()}">${esc(fmtDateLong(p.time))}</time></span>
                        <span><i class="fa-regular fa-clock text-cyan-400 mr-1"></i> ${p.readMin} min de leitura</span>
                    </div>
                    ${shareHtml(p, 'top')}
                    ${okImg(p.image) ? `<figure class="mt-6"><img src="${esc(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer" class="w-full max-h-[420px] object-cover rounded-2xl border border-gray-800" onerror="this.style.display='none'">${caption ? `<figcaption class="mt-2 text-xs text-gray-500 leading-relaxed">${caption}</figcaption>` : ''}</figure>` : ''}
                    <div class="article-body mt-6">${bodyHtml}</div>
                    ${tags ? `<div class="flex flex-wrap gap-2 mt-8">${tags}</div>` : ''}
                    ${shareHtml(p, 'bottom')}
                    ${p.authorBio ? `<aside class="mt-8 flex gap-4 bg-gray-900 border border-gray-800 rounded-2xl p-5" aria-label="Sobre o autor">
                        ${p.authorPhoto ? authorImg(p, 'w-14 h-14') : '<span class="w-14 h-14 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-user text-cyan-400"></i></span>'}
                        <div class="min-w-0">
                            <p class="text-[10px] uppercase tracking-widest text-cyan-400 font-extrabold">Sobre o autor</p>
                            <p class="text-sm font-bold text-white mt-0.5">${esc(p.author)}</p>
                            <p class="text-xs text-gray-400 mt-1 leading-relaxed">${esc(p.authorBio)}</p>
                        </div>
                    </aside>` : ''}

                    ${relatedHtml(related)}

                    <section id="comments" class="mt-10 pt-8 border-t border-gray-800 scroll-mt-24">
                        <h2 class="text-lg font-black text-white flex items-center gap-2"><i class="fa-regular fa-comments text-cyan-400"></i> Comentários <span id="comments-count" class="text-xs font-semibold text-gray-500"></span></h2>
                        <div id="comment-form-area" class="mt-4"><p class="text-sm text-gray-500">Carregando…</p></div>
                        <div id="comments-list" class="mt-6 space-y-5"><p class="text-sm text-gray-500">Carregando comentários…</p></div>
                        <button id="comments-more" type="button" class="hidden mt-6 text-xs font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-5 py-2.5 rounded-xl transition">Carregar mais comentários</button>
                    </section>
                </article>
                ${embedExtras(bodyHtml)}
                ${SHARE_SCRIPT}
                `;
}

const fmtDateShort = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' });

function cardHtml(p) {
  const cats = (p.categories.length ? p.categories : ['Notícias'])
    .map((c) => `<span class="border text-[10px] font-bold px-2.5 py-0.5 rounded uppercase ${catStyle(c)}">${esc(c)}</span>`).join('');
  return `
                        <a href="${esc(p.url)}" class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden card-hover flex flex-col group">
                            <div class="relative h-48 overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950">
                                ${okImg(p.image) ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.style.display='none'">` : ''}
                                <div class="absolute top-3 left-3 flex flex-wrap gap-1.5 ${p.rating != null ? 'max-w-[68%]' : 'max-w-[calc(100%-1.5rem)]'}">${cats}</div>
                                ${p.rating != null ? `<span class="absolute top-3 right-3 bg-cyan-400 text-black font-black text-xs px-2 py-0.5 rounded">NOTA ${esc(p.rating)}</span>` : ''}
                            </div>
                            <div class="p-5 flex flex-col flex-grow">
                                <div class="flex items-center text-[11px] text-gray-400 gap-3 mb-2">
                                    <span class="flex-shrink-0"><i class="fa-regular fa-clock text-cyan-400"></i> ${p.readMin} min</span>
                                </div>
                                <h3 class="text-base font-bold text-white group-hover:text-cyan-300 transition line-clamp-2 mb-2">${esc(p.title)}</h3>
                                <p class="text-xs text-gray-400 line-clamp-3 mb-4 leading-relaxed">${esc(p.summary)}</p>
                                <div class="mt-auto pt-3 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400">
                                    <span class="text-gray-300 flex items-center gap-1.5 min-w-0">${authorImg(p, 'w-5 h-5')}<span class="truncate">${esc(p.author)}</span></span>
                                    <span class="flex-shrink-0">${esc(fmtDateShort(p.time))}</span>
                                </div>
                            </div>
                        </a>`;
}

function categoryHtml(cat, list) {
  return `
                <div class="space-y-8">
                    <h1 class="sr-only">${esc(cat.name)}</h1>
                    ${list.length
                      ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">${list.map(cardHtml).join('')}
                    </div>`
                      : `<p class="text-sm text-gray-500 py-6">Ainda não há matérias nesta categoria. Volte em breve!</p>`}
                </div>
                `;
}

function profileHtml() {
  return `
                <div id="profile-root">
                    <div class="mb-3">
                        <h1 class="text-xl font-black uppercase tracking-wide flex items-center gap-2 text-white">
                            <span class="w-3 h-6 bg-cyan-400 rounded-sm"></span> Meu perfil
                        </h1>
                    </div>

                    <p id="profile-loading" class="text-sm text-gray-500">Carregando…</p>

                    <div id="profile-guest" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                        <i class="fa-regular fa-circle-user text-4xl text-cyan-400 mb-3"></i>
                        <h2 class="text-lg font-black text-white">Faça login para ver o seu perfil</h2>
                        <p class="text-sm text-gray-400 mt-2 mb-5">Com uma conta você comenta nas matérias e personaliza o seu perfil.</p>
                        <button type="button" onclick="toggleAuthModal()" class="bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Entrar</button>
                    </div>

                    <div id="profile-main" class="hidden">
                        <div class="border-b border-gray-800 mb-4">
                        <div id="profile-tabs" role="tablist" aria-label="Seções do perfil" class="flex gap-1 overflow-x-auto overflow-y-hidden cg-noscrollbar">
                            <button type="button" id="ptab-btn-perfil" data-ptab="perfil" role="tab" aria-controls="ptab-perfil" aria-selected="false" tabindex="-1" class="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-extrabold border-b-2 border-transparent text-gray-400 hover:text-gray-200 whitespace-nowrap transition"><i class="fa-regular fa-user hidden sm:inline text-cyan-400"></i> Perfil</button>
                            <button type="button" id="ptab-btn-area" data-ptab="area" role="tab" aria-controls="ptab-area" aria-selected="false" tabindex="-1" class="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-extrabold border-b-2 border-transparent text-gray-400 hover:text-gray-200 whitespace-nowrap transition"><i class="fa-regular fa-bookmark hidden sm:inline text-cyan-400"></i> Minha área</button>
                            <button type="button" id="ptab-btn-config" data-ptab="config" role="tab" aria-controls="ptab-config" aria-selected="false" tabindex="-1" class="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-extrabold border-b-2 border-transparent text-gray-400 hover:text-gray-200 whitespace-nowrap transition"><i class="fa-solid fa-sliders hidden sm:inline text-cyan-400"></i> Preferências</button>
                            <button type="button" id="ptab-btn-mod" data-ptab="mod" role="tab" aria-controls="ptab-mod" aria-selected="false" tabindex="-1" class="hidden inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-extrabold border-b-2 border-transparent text-gray-400 hover:text-gray-200 whitespace-nowrap transition"><i class="fa-solid fa-shield-halved hidden sm:inline text-cyan-400"></i> Moderação</button>
                        </div>
                        </div>

                        <div id="ptab-perfil" role="tabpanel" aria-labelledby="ptab-btn-perfil">
                    <div id="profile-user" class="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                        <form id="profile-form" class="flex items-start gap-4 pb-4 border-b border-gray-800" novalidate>
                            <div class="flex flex-col items-center gap-2 flex-shrink-0">
                                <div id="profile-avatar" class="relative w-20 h-20 rounded-full overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center text-2xl font-black text-cyan-400"></div>
                                <div class="relative">
                                    <button id="profile-photo-menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" class="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 rounded-lg transition whitespace-nowrap"><i class="fa-solid fa-camera"></i> Alterar foto <i id="profile-photo-caret" class="hidden fa-solid fa-chevron-down text-[8px]"></i></button>
                                    <div id="profile-photo-menu" role="menu" class="hidden absolute left-0 top-full mt-1 z-20 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                                        <button id="profile-photo-btn" type="button" role="menuitem" class="block w-full text-left text-xs font-bold text-gray-200 hover:bg-gray-800 px-3 py-2 transition"><i class="fa-regular fa-image mr-2 text-cyan-400"></i> Escolher nova foto</button>
                                        <button id="profile-photo-remove" type="button" role="menuitem" class="hidden block w-full text-left text-xs font-bold text-gray-300 hover:bg-gray-800 hover:text-red-400 px-3 py-2 transition"><i class="fa-regular fa-trash-can mr-2"></i> Remover foto</button>
                                    </div>
                                    <input id="profile-photo-input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
                                </div>
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <label for="profile-name" class="sr-only">Nome de exibição</label>
                                    <input id="profile-name" type="text" maxlength="40" autocomplete="nickname" class="h-9 flex-1 basis-40 min-w-0 max-w-xs bg-gray-950 border border-gray-800 hover:border-gray-700 focus:border-cyan-400 focus:outline-none rounded-lg px-3 text-[16px] sm:text-sm font-bold text-white transition">
                                    <div class="flex items-center gap-2 ml-auto flex-shrink-0">
                                        <button id="profile-save" type="submit" disabled class="inline-flex items-center justify-center h-9 px-4 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold text-xs rounded-lg transition whitespace-nowrap">Salvar</button>
                                        <button type="button" onclick="logout()" aria-label="Sair da conta" class="inline-flex items-center justify-center gap-2 h-9 px-3 flex-shrink-0 border border-gray-700 hover:border-red-400 hover:text-red-400 text-gray-300 text-xs font-bold rounded-lg transition whitespace-nowrap">
                                            <i class="fa-solid fa-arrow-right-from-bracket"></i> <span class="sm:hidden">Sair</span><span class="hidden sm:inline">Sair da conta</span>
                                        </button>
                                    </div>
                                </div>
                                <p id="profile-since" class="text-xs text-gray-500 mt-2"></p>
                                <div id="profile-stats" class="hidden mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                                    <span id="profile-level"></span>
                                    <span id="profile-count"></span>
                                </div>
                                <p id="profile-photo-msg" class="text-[11px] mt-2 cg-empty-hide" role="status" aria-live="polite"></p>
                                <p id="profile-msg" class="text-xs mt-1 cg-empty-hide" role="status" aria-live="polite"></p>
                            </div>
                        </form>

                        <dl class="py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border-b border-gray-800">
                            <div>
                                <dt class="text-gray-500">E-mail <span class="text-gray-600">(só você vê)</span></dt>
                                <dd id="profile-email" class="text-gray-200 mt-1 break-all"></dd>
                            </div>
                            <div>
                                <dt class="text-gray-500">Entrou com</dt>
                                <dd id="profile-provider" class="text-gray-200 mt-1"></dd>
                            </div>
                        </dl>

                        <div id="profile-about" class="pt-6">
                            <h2 class="text-sm font-black text-white flex items-center gap-2"><i class="fa-regular fa-id-card text-cyan-400"></i> Sobre você</h2>
                            <form id="about-form" class="mt-4 space-y-5" novalidate>
                                <div>
                                    <label for="about-bio" class="block text-xs font-bold text-gray-300">Bio</label>
                                    <p class="text-[11px] text-gray-500 mt-1">Até 160 caracteres, sem links. Aparece só no seu perfil público.</p>
                                    <textarea id="about-bio" rows="3" maxlength="160" class="mt-2 w-full resize-none bg-gray-950 border border-gray-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-400"></textarea>
                                    <p class="text-[11px] text-gray-600 mt-1 text-right"><span id="about-bio-count">0</span>/160</p>
                                </div>
                                <div>
                                    <p class="text-xs font-bold text-gray-300">Redes <span class="font-normal text-gray-500">(até 4, só o nome de usuário)</span></p>
                                    <div id="about-links" class="mt-2 space-y-2"></div>
                                    <button type="button" id="about-add" class="mt-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition"><i class="fa-solid fa-plus mr-1"></i> Adicionar rede</button>
                                </div>
                                <div class="flex items-center gap-3">
                                    <button id="about-save" type="submit" class="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Salvar</button>
                                    <p id="about-msg" class="text-xs min-h-[1rem]" role="status" aria-live="polite"></p>
                                </div>
                            </form>
                        </div>
                    </div>
                        </div>

                        <div id="ptab-area" role="tabpanel" aria-labelledby="ptab-btn-area" class="hidden">
                        <div id="profile-library" class="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                            <h2 class="text-sm font-black text-white flex items-center gap-2"><i class="fa-regular fa-bookmark text-cyan-400"></i> Minha área</h2>
                            <div id="lib-tabs" role="tablist" class="grid grid-cols-3 gap-1 bg-gray-950 border border-gray-800 rounded-xl p-1 mt-4">
                                <button type="button" id="lib-tab-saved" role="tab" class="text-xs font-extrabold py-2 rounded-lg transition">Salvos</button>
                                <button type="button" id="lib-tab-comments" role="tab" class="text-xs font-extrabold py-2 rounded-lg transition">Meus comentários</button>
                                <button type="button" id="lib-tab-recent" role="tab" class="text-xs font-extrabold py-2 rounded-lg transition">Últimas lidas</button>
                            </div>

                            <div id="lib-pane-saved" class="mt-5">
                                <div id="lib-saved-list" class="space-y-3"></div>
                            </div>

                            <div id="lib-pane-comments" class="hidden mt-5">
                                <div id="lib-comments-list" class="space-y-3"></div>
                                <button id="lib-comments-more" type="button" class="hidden mt-4 text-xs font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-5 py-2.5 rounded-xl transition">Carregar mais</button>
                            </div>

                            <div id="lib-pane-recent" class="hidden mt-5">
                                <div id="lib-recent-list" class="space-y-3"></div>
                                <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
                                    <p class="text-[11px] text-gray-600">Esta lista fica guardada só neste aparelho e navegador. Não vai para os nossos servidores.</p>
                                    <button id="lib-recent-clear" type="button" class="hidden text-[11px] font-bold text-gray-500 hover:text-red-400 transition">Limpar lista</button>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div id="ptab-config" role="tabpanel" aria-labelledby="ptab-btn-config" class="hidden">
                        <div id="profile-prefs" class="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                            <h2 class="text-sm font-black text-white flex items-center gap-2"><i class="fa-solid fa-sliders text-cyan-400"></i> Preferências</h2>
                            <div class="mt-4">
<div class="bg-gray-950 border border-gray-800 rounded-xl p-4">
                                <label class="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" id="about-public" class="mt-0.5 accent-cyan-400">
                                    <span class="text-xs text-gray-300 leading-relaxed"><strong class="text-white">Manter meu perfil público.</strong> Quem clicar no seu nome nos comentários poderá ver o seu nome, foto, bio, redes, a data em que você entrou e os seus comentários publicados. Vem ligado, e você pode desligar quando quiser: aí só o seu nome e a sua foto continuam aparecendo.</span>
                                </label>
                                </div>
                                <p id="public-msg" class="text-xs min-h-[1rem] mt-3" role="status" aria-live="polite"></p>
                            </div>
                            <div class="mt-3">
<label class="mt-4 flex items-start gap-3 bg-gray-950 border border-gray-800 rounded-xl p-4 cursor-pointer">
                                <input type="checkbox" id="notify-replies" class="mt-0.5 accent-cyan-400" disabled>
                                <span class="text-xs text-gray-300 leading-relaxed"><strong class="text-white">Avisar por e-mail quando alguém responder ao meu comentário.</strong> Enviamos para o e-mail da sua conta, no máximo 5 por hora, e todo aviso traz um link para parar de receber.</span>
                            </label>
                                <p id="notify-msg" class="text-xs min-h-[1rem] mt-3" role="status" aria-live="polite"></p>
                            </div>

                            <div class="mt-6 pt-6 border-t border-gray-800">
                            <h2 class="text-sm font-black text-white">Excluir minha conta</h2>
                            <p class="text-xs text-gray-400 mt-2 leading-relaxed">Apaga a sua conta, o seu nome e a sua foto. Os seus comentários também são apagados; se algum tiver respostas de outras pessoas, ele passa a aparecer como “Comentário removido”. Esta ação não pode ser desfeita.</p>
                            <button id="profile-delete-open" type="button" class="mt-3 inline-flex items-center gap-2 border border-red-500/40 hover:bg-red-500/10 text-red-400 text-xs font-bold px-4 py-2.5 rounded-xl transition">
                                <i class="fa-regular fa-trash-can"></i> Excluir minha conta
                            </button>
                            <div id="profile-delete-box" class="hidden mt-4 bg-red-500/5 border border-red-500/30 rounded-xl p-4 space-y-3">
                                <label for="profile-delete-input" class="block text-xs text-gray-300">Para confirmar, digite <strong class="text-white">EXCLUIR</strong>:</label>
                                <input id="profile-delete-input" type="text" autocomplete="off" autocapitalize="characters" class="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-[16px] sm:text-sm text-white focus:outline-none focus:border-red-400">
                                <div class="flex items-center gap-2">
                                    <button id="profile-delete-go" type="button" disabled class="bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs px-4 py-2.5 rounded-lg transition">Excluir definitivamente</button>
                                    <button id="profile-delete-cancel" type="button" class="text-xs font-bold text-gray-400 hover:text-white px-3 py-2 transition">Cancelar</button>
                                </div>
                                <p id="profile-delete-msg" class="text-xs min-h-[1rem]" role="alert"></p>
                            </div>
                            </div>
                        </div>
                        </div>

                        <div id="ptab-mod" role="tabpanel" aria-labelledby="ptab-btn-mod" class="hidden">
                        <div id="profile-mod" class="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                            <h2 class="text-sm font-black text-white flex items-center gap-2"><i class="fa-solid fa-shield-halved text-cyan-400"></i> Painel de moderação</h2>
                            <p class="text-xs text-gray-400 mt-2 leading-relaxed">Moderadores podem esconder, apagar e bloquear comentários e limpar perfis. Só a conta principal vê este painel e pode adicionar ou remover moderadores. Adicione só pessoas de confiança.</p>
                            <a href="/moderacao/" class="inline-flex items-center gap-2 mt-3 h-9 px-3 border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 text-xs font-bold rounded-lg transition"><i class="fa-regular fa-comments"></i> Abrir fila de comentários</a>

                            <h3 class="mt-6 text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">Moderadores</h3>
                            <div id="mod-list" class="mt-3 space-y-2" aria-live="polite"><p class="text-xs text-gray-500">Carregando…</p></div>

                            <form id="mod-add-form" class="mt-5 flex flex-wrap items-center gap-2" novalidate>
                                <label for="mod-add-email" class="sr-only">E-mail da pessoa</label>
                                <input id="mod-add-email" type="email" autocomplete="off" maxlength="120" placeholder="E-mail da pessoa (ela já precisa ter entrado no site)" class="h-9 flex-1 basis-56 min-w-0 bg-gray-950 border border-gray-800 hover:border-gray-700 focus:border-cyan-400 focus:outline-none rounded-lg px-3 text-[16px] sm:text-sm text-white placeholder-gray-600 transition">
                                <button id="mod-add-btn" type="submit" class="inline-flex items-center justify-center h-9 px-4 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold text-xs rounded-lg transition whitespace-nowrap">Adicionar moderador</button>
                            </form>
                            <p id="mod-msg" class="text-xs mt-3 cg-empty-hide" role="status" aria-live="polite"></p>
                        </div>
                        </div>
                    </div>
                </div>
                `;
}

/* ---------- Páginas fixas: Privacidade, Termos, Sobre, Contato e Política Editorial ---------- */

const LEGAL_PAGES = [
  { slug: 'privacidade', file: 'privacidade.md', fallbackTitle: 'Política de Privacidade' },
  { slug: 'termos', file: 'termos.md', fallbackTitle: 'Termos de Uso' },
  // Páginas de confiança (editáveis no painel: Páginas do site)
  { slug: 'sobre', file: 'sobre.md', fallbackTitle: 'Sobre nós' },
  { slug: 'contato', file: 'contato.md', fallbackTitle: 'Contato' },
  { slug: 'politica-editorial', file: 'politica-editorial.md', fallbackTitle: 'Política Editorial' }
];

// Quem responde pelo site e o e-mail de contato: editável no painel (Configurações do site)
function loadContact() {
  let c = { responsavel: '', email: '' };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'settings', 'contato.json'), 'utf8'));
    c.responsavel = String(j.responsavel || '').replace(/\s+/g, ' ').trim();
    c.email = String(j.email || '').trim();
  } catch (e) { /* arquivo ainda não existe */ }
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) c.email = '';
  return c;
}

function fillTokens(md, c) {
  const resp = c.responsavel || '**[responsável pelo site a ser informado]**';
  const mail = c.email ? `[${c.email}](mailto:${c.email})` : '**[e-mail de contato a ser informado]**';
  return md.replace(/\{\{RESPONSAVEL\}\}/g, resp).replace(/\{\{EMAIL_LINK\}\}/g, mail);
}

function loadLegalPage(def, mdParse, contact) {
  const file = path.join(ROOT, 'content', 'pages', def.file);
  if (!fs.existsSync(file)) { console.warn('[build] AVISO: página ausente: content/pages/' + def.file); return null; }
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) { console.warn('[build] AVISO: sem frontmatter em ' + def.file); return null; }
  const meta = yaml.load(m[1]) || {};
  return {
    slug: def.slug,
    url: '/' + def.slug + '/',
    title: String(meta.title || def.fallbackTitle),
    description: String(meta.description || '').replace(/\s+/g, ' ').trim(),
    updated: meta.updated ? String(meta.updated) : '',
    html: mdParse(fillTokens((m[2] || '').trim(), contact))
  };
}

function buildLegalPage(template, pg) {
  const url = SITE_URL + pg.url;
  const title = seoTitle(pg.title);
  const main = `
                <article class="pb-8">
                    <h1 class="text-3xl sm:text-4xl font-black text-white leading-tight">${esc(pg.title)}</h1>
                    ${pg.updated ? `<p class="text-xs text-gray-500 mt-2">Última atualização: ${esc(pg.updated)}</p>` : ''}
                    <div class="article-body mt-6">${pg.html}</div>
                </article>
                `;
  return template
    .replace('<!--CG:HEAD-->', headTags({ title, description: pg.description || pg.title, url, image: '', type: 'website', rich: true }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="page"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => main);
}

function buildProfilePage(template) {
  const title = 'Meu perfil | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Gerencie o seu perfil no ' + SITE_NAME + '.', url: SITE_URL + '/perfil/', image: '', type: 'website'
    }) + '\n    <meta name="robots" content="noindex, nofollow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="profile"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => profileHtml());
}

function publicProfileHtml() {
  return `
                <div id="pub-root" class="max-w-2xl">
                    <p id="pub-loading" class="text-sm text-gray-500">Carregando…</p>

                    <div id="pub-missing" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                        <i class="fa-regular fa-eye-slash text-4xl text-gray-600 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Perfil não encontrado</h1>
                        <p class="text-sm text-gray-400 mt-2">Este perfil não existe ou foi removido.</p>
                        <a href="/" class="inline-block mt-5 text-xs font-bold text-cyan-400 hover:underline">Voltar para o início</a>
                    </div>

                    <div id="pub-card" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                        <div class="flex items-center gap-4">
                            <div id="pub-avatar" class="relative w-20 h-20 rounded-full overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center text-2xl font-black text-cyan-400 flex-shrink-0"></div>
                            <div class="min-w-0">
                                <h1 id="pub-name" class="text-xl font-black text-white break-words"></h1>
                                <p id="pub-role" class="text-[11px] uppercase tracking-wider font-bold text-gray-500 mt-1">Leitor do ${SITE_NAME}</p>
                                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                                    <span id="pub-level" class="hidden"></span>
                                    <span id="pub-since" class="hidden"></span>
                                    <span id="pub-count" class="hidden"></span>
                                </div>
                            </div>
                        </div>
                        <p id="pub-bio" class="hidden mt-5 text-sm text-gray-300 leading-relaxed break-words"></p>
                        <div id="pub-links" class="mt-5 flex flex-wrap gap-2"></div>
                        <p id="pub-private" class="hidden mt-5 text-sm text-gray-400 leading-relaxed bg-gray-950 border border-gray-800 rounded-xl p-4"></p>
                        <a id="pub-edit" href="/perfil/" class="hidden mt-5 inline-flex items-center gap-2 text-xs font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-4 py-2 rounded-lg transition"><i class="fa-regular fa-pen-to-square"></i> Editar meu perfil</a>
                        <button id="pub-mod" type="button" class="hidden mt-6 text-[11px] font-bold text-amber-400 hover:text-amber-300 border border-amber-400/30 rounded-lg px-3 py-1.5 transition"><i class="fa-solid fa-shield-halved mr-1"></i> Moderação: limpar bio e redes e ocultar este perfil</button>
                    </div>

                    <div id="pub-comments-wrap" class="hidden mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                        <h2 class="text-sm font-black text-white flex items-center gap-2"><i class="fa-regular fa-comments text-cyan-400"></i> Comentários</h2>
                        <div id="pub-comments" class="mt-4 space-y-3"></div>
                        <button id="pub-comments-more" type="button" class="hidden mt-4 text-xs font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-5 py-2.5 rounded-xl transition">Carregar mais</button>
                    </div>
                </div>
                `;
}

function buildPublicProfilePage(template) {
  const title = 'Perfil de leitor | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Perfil de leitor do ' + SITE_NAME + '.', url: SITE_URL + '/u/', image: '', type: 'website'
    }) + '\n    <meta name="robots" content="noindex, nofollow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="public-profile"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => publicProfileHtml());
}

function noticesHtml() {
  return `
                <div id="notice-root" class="max-w-xl">
                    <div id="notice-ask" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                        <i class="fa-regular fa-bell-slash text-4xl text-cyan-400 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Parar de receber avisos de resposta?</h1>
                        <p class="text-sm text-gray-400 mt-2 mb-5">Você deixará de receber e-mail quando alguém responder aos seus comentários. Dá para voltar a receber quando quiser, em Meu perfil.</p>
                        <button id="notice-confirm" type="button" class="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Sim, parar de receber</button>
                        <a href="/" class="block mt-4 text-xs font-bold text-gray-500 hover:text-cyan-400 transition">Não, voltar ao site</a>
                    </div>
                    <div id="notice-done" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                        <i class="fa-solid fa-circle-check text-4xl text-emerald-400 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Pronto! Você não receberá mais esses avisos.</h1>
                        <p class="text-sm text-gray-400 mt-2">Mudou de ideia? Entre em Meu perfil e ligue "Avisos por e-mail".</p>
                        <a href="/perfil/" class="inline-block mt-5 text-xs font-bold text-cyan-400 hover:underline">Ir para Meu perfil</a>
                    </div>
                    <div id="notice-error" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                        <i class="fa-regular fa-circle-xmark text-4xl text-gray-600 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Link inválido ou já usado</h1>
                        <p id="notice-error-text" class="text-sm text-gray-400 mt-2">Para gerenciar os avisos, entre em Meu perfil.</p>
                        <a href="/perfil/" class="inline-block mt-5 text-xs font-bold text-cyan-400 hover:underline">Ir para Meu perfil</a>
                    </div>
                </div>
                `;
}

function buildNoticesPage(template) {
  const title = 'Avisos por e-mail | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Gerencie os avisos por e-mail do ' + SITE_NAME + '.', url: SITE_URL + '/avisos/', image: '', type: 'website', noAnalytics: true
    }) + '\n    <meta name="robots" content="noindex, nofollow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="notices"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => noticesHtml());
}

function newsletterHtml() {
  const panel = (id, inner) => `<div id="${id}" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">${inner}</div>`;
  return `
                <div id="nlp-root" class="max-w-xl">
                    ${panel('nlp-confirm-ask', `
                        <i class="fa-regular fa-envelope-open text-4xl text-cyan-400 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Confirmar o seu e-mail</h1>
                        <p class="text-sm text-gray-400 mt-2 mb-5">Confirme para receber um aviso por e-mail sempre que sair matéria nova no ${SITE_NAME}. Dá para cancelar quando quiser, por um link em cada e-mail.</p>
                        <button id="nlp-confirm-btn" type="button" class="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Confirmar meu e-mail</button>
                        <a href="/" class="block mt-4 text-xs font-bold text-gray-500 hover:text-cyan-400 transition">Voltar ao site</a>`)}
                    ${panel('nlp-unsub-ask', `
                        <i class="fa-regular fa-bell-slash text-4xl text-cyan-400 mb-3"></i>
                        <h1 class="text-lg font-black text-white">Cancelar a inscrição?</h1>
                        <p class="text-sm text-gray-400 mt-2 mb-5">Você deixará de receber os avisos de matéria nova por e-mail. Se mudar de ideia, é só se cadastrar de novo no rodapé do site.</p>
                        <button id="nlp-unsub-btn" type="button" class="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Sim, cancelar inscrição</button>
                        <a href="/" class="block mt-4 text-xs font-bold text-gray-500 hover:text-cyan-400 transition">Não, voltar ao site</a>`)}
                    ${panel('nlp-result', `
                        <i id="nlp-result-icon" class="fa-solid fa-circle-check text-4xl text-emerald-400 mb-3"></i>
                        <h1 id="nlp-result-title" class="text-lg font-black text-white"></h1>
                        <p id="nlp-result-text" class="text-sm text-gray-400 mt-2"></p>
                        <a href="/" class="inline-block mt-5 text-xs font-bold text-cyan-400 hover:underline">Ir para o ${SITE_NAME}</a>`)}
                </div>
                `;
}

function buildNewsletterPage(template) {
  const title = 'Newsletter | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Confirme ou cancele a inscrição na newsletter do ' + SITE_NAME + '.', url: SITE_URL + '/newsletter/', image: '', type: 'website', noAnalytics: true
    }) + '\n    <meta name="robots" content="noindex, nofollow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="newsletter"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => newsletterHtml());
}

function moderationHtml() {
  const tab = (id, label) => `<button type="button" id="mod-tab-${id}" data-tab="${id}" role="tab" class="text-xs font-extrabold py-2 px-4 rounded-lg transition">${label}</button>`;
  return `
                <div id="mod-root" class="space-y-6">
                    <div>
                        <h1 class="text-xl font-black text-white flex items-center gap-2"><i class="fa-solid fa-shield-halved text-cyan-400"></i> Moderação</h1>
                        <p class="text-xs text-gray-500 mt-1">Área restrita aos moderadores do site.</p>
                    </div>

                    <p id="mod-loading" class="text-sm text-gray-400">Carregando…</p>

                    <div id="mod-denied" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center space-y-4">
                        <p id="mod-denied-text" class="text-sm text-gray-300"></p>
                        <button id="mod-login" type="button" onclick="toggleAuthModal()" class="hidden bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs px-6 py-2.5 rounded-xl transition">Entrar</button>
                    </div>

                    <div id="mod-panel" class="hidden space-y-4">
                        <div id="mod-tabs" role="tablist" class="flex flex-wrap gap-1 bg-gray-950 border border-gray-800 rounded-xl p-1 w-fit">
                            ${tab('reported', 'Denunciados')}
                            ${tab('recent', 'Recentes')}
                            ${tab('hidden', 'Escondidos')}
                        </div>
                        <p id="mod-status" class="text-xs text-gray-500 min-h-[1rem]" role="status" aria-live="polite"></p>
                        <div id="mod-list" class="space-y-3"></div>
                        <button id="mod-more" type="button" class="hidden w-full border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 text-xs font-bold py-3 rounded-xl transition">Carregar mais</button>
                    </div>
                </div>
                `;
}

function buildModerationPage(template) {
  const title = 'Moderação | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Área restrita.', url: SITE_URL + '/moderacao/', image: '', type: 'website', noAnalytics: true
    }) + '\n    <meta name="robots" content="noindex, nofollow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="moderation"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => moderationHtml());
}

function searchHtml() {
  return `
                <div id="search-root" class="space-y-6">
                    <form action="/busca/" method="get" role="search" class="flex gap-2">
                        <input id="search-page-input" type="search" name="q" maxlength="80" autocomplete="off" placeholder="Buscar matérias, jogos, plataformas…" aria-label="O que você procura?"
                            class="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-400">
                        <button type="submit" class="flex-shrink-0 inline-flex items-center gap-2 bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs px-5 py-3 rounded-xl transition">
                            <i class="fa-solid fa-magnifying-glass"></i> Buscar
                        </button>
                    </form>
                    <p id="search-status" class="text-sm text-gray-400 min-h-[1.25rem]" role="status" aria-live="polite"></p>
                    <div id="posts-container" class="grid grid-cols-1 sm:grid-cols-2 gap-6"></div>
                </div>
                `;
}

function buildSearchPage(template) {
  const title = 'Buscar | ' + SITE_NAME;
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: 'Busque matérias, reviews e notícias no ' + SITE_NAME + '.', url: SITE_URL + '/busca/', image: '', type: 'website'
    }) + '\n    <meta name="robots" content="noindex, follow">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="search"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => searchHtml());
}

function buildCategoryPage(template, cat, list) {
  const url = SITE_URL + '/categoria/' + cat.slug + '/';
  const title = cat.name + ' - Notícias e Reviews | ' + SITE_NAME;
  const withImg = list.find((p) => absUrl(p.image));
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: cat.desc, url, image: withImg ? absUrl(withImg.image) : '', type: 'website', rich: true
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="category"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => categoryHtml(cat, list));
}

/* ---------- Feed RSS (/feed.xml) ----------
 * Últimas FEED_ITEMS matérias, só com título, resumo, imagem e link (o texto completo fica no site:
 * isso leva a visita para cá e dificulta cópia). Para mostrar o texto inteiro no leitor de RSS,
 * troque o conteúdo de `description` abaixo por p.html. */
const FEED_ITEMS = 30;
const xmlClean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const xmlEsc = (s) => esc(xmlClean(s));
// llms.txt: um "cartão de visita" em texto simples para buscadores e assistentes de IA (ChatGPT, Perplexity,
// Claude...) entenderem o site. Lista o que é o portal, as seções, as páginas de confiança e as matérias recentes.
function buildLlmsTxt(posts, legalPages) {
  const L = [];
  L.push('# ' + SITE_NAME, '');
  L.push('> Portal brasileiro de notícias, reviews e lançamentos de games e tecnologia, com apuração própria. Conteúdo em português do Brasil.', '');
  L.push('## Seções', '');
  for (const c of CATEGORIES) L.push('- [' + c.name + '](' + SITE_URL + '/categoria/' + c.slug + '/)' + (c.desc ? ': ' + String(c.desc).replace(/\s+/g, ' ') : ''));
  L.push('', '## Sobre o site', '');
  for (const pg of legalPages) L.push('- [' + pg.title + '](' + SITE_URL + pg.url + ')' + (pg.description ? ': ' + String(pg.description).replace(/\s+/g, ' ') : ''));
  L.push('', '## Matérias recentes', '');
  for (const p of posts.slice(0, 30)) L.push('- [' + p.title.replace(/[\[\]]/g, '') + '](' + SITE_URL + p.url + ')' + (p.summary ? ': ' + clip(String(p.summary).replace(/\s+/g, ' '), 140) : ''));
  L.push('', '## Assinar', '', '- [Feed RSS](' + SITE_URL + '/feed.xml)', '- [Mapa do site](' + SITE_URL + '/sitemap.xml)', '');
  return L.join('\n');
}

// Avisa no log do deploy quais matérias usam capa hospedada em OUTRO site. Se esse site tirar a imagem do ar
// (ou bloquear), a capa quebra; além disso, imagem de terceiros pode ter direitos autorais. Não derruba o build.
function warnExternalCovers(posts) {
  let siteHost = '';
  try { siteHost = new URL(SITE_URL).host; } catch (e) {}
  const ext = posts.filter((p) => {
    const u = absUrl(p.image);
    if (!u) return false;
    try { const h = new URL(u).host; return h !== siteHost && !/supabase\.co$/.test(h); } catch (e) { return false; }
  });
  if (!ext.length) return;
  console.warn('[build] AVISO: ' + ext.length + ' matéria(s) usam capa hospedada em outro site (pode quebrar ou ter direitos autorais). Prefira enviar a imagem pelo painel:');
  ext.slice(0, 20).forEach((p) => console.warn('  - ' + p.url + '  ->  ' + absUrl(p.image)));
}

function buildFeed(posts) {
  const list = posts.slice(0, FEED_ITEMS);
  const latest = list.length ? list[0].time : Date.now();
  const items = list.map((p) => {
    const link = SITE_URL + p.url;
    const img = absUrl(p.image);
    const desc = (img ? `<p><img src="${esc(img)}" alt="${esc(p.title)}" /></p>` : '') +
      `<p>${esc(p.summary || p.title)}</p>` +
      `<p><a href="${esc(link)}">Continue lendo no ${esc(SITE_NAME)}</a></p>`;
    const cats = Array.from(new Set([].concat(p.categories || [], p.tags || []).map((c) => String(c).trim()).filter(Boolean))).slice(0, 8);
    return [
      '    <item>',
      `      <title>${xmlEsc(p.title)}</title>`,
      `      <link>${xmlEsc(link)}</link>`,
      `      <guid isPermaLink="true">${xmlEsc(link)}</guid>`,
      `      <pubDate>${new Date(p.time).toUTCString()}</pubDate>`,
      `      <dc:creator>${xmlEsc(p.author || SITE_NAME)}</dc:creator>`,
      ...cats.map((c) => `      <category>${xmlEsc(c)}</category>`),
      `      <description>${xmlEsc(desc)}</description>`,
      img ? `      <media:content url="${xmlEsc(img)}" medium="image" />` : '',
      '    </item>'
    ].filter(Boolean).join('\n');
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">\n' +
    '  <channel>\n' +
    `    <title>${xmlEsc(SITE_NAME)}</title>\n` +
    `    <link>${xmlEsc(SITE_URL + '/')}</link>\n` +
    `    <description>${xmlEsc('Notícias, reviews e lançamentos de games e tecnologia no ' + SITE_NAME + '.')}</description>\n` +
    '    <language>pt-BR</language>\n' +
    `    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>\n` +
    `    <atom:link href="${xmlEsc(SITE_URL + '/feed.xml')}" rel="self" type="application/rss+xml" />\n` +
    (items.length ? items.join('\n') + '\n' : '') +
    '  </channel>\n</rss>\n';
}

function headTags({ title, description, url, image, type, jsonLd, noAnalytics, rich }) {
  const lines = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    ...(rich ? ['<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">'] : []),
    `<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${SITE_URL}/feed.xml">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`
  ];
  if (image) {
    lines.push(`<meta property="og:image" content="${esc(image)}">`);
    lines.push(`<meta name="twitter:image" content="${esc(image)}">`);
  }
  if (jsonLd) {
    lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  if (ANALYTICS && !noAnalytics) {
    lines.push(`<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>`);
    lines.push(`<script defer src="/_vercel/insights/script.js"></script>`);
  }
  return lines.join('\n    ');
}

// Título da aba/Google (<title>): o Google corta perto de 60-70 caracteres. Se "Título | Conexão Gamer"
// couber em 70, mantém a marca; senão usa só o título e, se ainda passar de 70, corta numa palavra inteira.
function seoTitle(base) {
  const full = base + ' | ' + SITE_NAME;
  if (full.length <= 70) return full;
  if (base.length <= 70) return base;
  return base.slice(0, 69).replace(/\s+\S*$/, '').replace(/[\s,;:\-–—]+$/, '') + '…';
}

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

// Cards das matérias já escritos no HTML da home. A lista (da 4ª matéria em diante, pois as 3 mais recentes
// ficam no destaque, que é do JavaScript) é dividida em abas de HOME_PAGE_SIZE matérias: aqui sai a 1ª aba.
// As 3 do destaque e as das outras abas entram como links simples em <noscript> (plano B sem JavaScript).
// Quando a página abre, o JavaScript da home troca este conteúdo pelos cards dele, sem mudar nada para o leitor.
// (Se mudar HOME_PAGE_SIZE, mude também PAGE_SIZE no index.html.)
const GRID_PLACEHOLDER = '<div id="posts-container" class="grid grid-cols-1 sm:grid-cols-2 gap-6"></div>';
const HOME_PAGE_SIZE = 8;

function homeGridHtml(posts) {
  const grid = posts.slice(3);
  const cards = grid.slice(0, HOME_PAGE_SIZE).map(cardHtml).join('');
  const others = posts.slice(0, 3).concat(grid.slice(HOME_PAGE_SIZE, HOME_PAGE_SIZE + 100));
  const lead = others.map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a></li>`).join('');
  return `<div id="posts-container" class="grid grid-cols-1 sm:grid-cols-2 gap-6">${cards}</div>` +
    (lead ? `<noscript><ul>${lead}</ul></noscript>` : '');
}

function buildHome(template, posts) {
  const first = posts.find((p) => absUrl(p.image));
  if (!template.includes(GRID_PLACEHOLDER)) console.warn('[build] AVISO: não achei #posts-container no index.html; a home sairá sem os cards pré-renderizados.');
  return template
    .replace(GRID_PLACEHOLDER, () => homeGridHtml(posts))
    .replace('<!--CG:HEAD-->', headTags({
      title: SITE_NAME + ' | Portal de Notícias, Reviews e Lançamentos',
      description: 'Sua conexão com o universo dos games: lançamentos, notícias em tempo real, reviews e tudo sobre tecnologia.',
      url: SITE_URL + '/',
      image: first ? absUrl(first.image) : '',
      type: 'website',
      rich: true,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', '@id': SITE_URL + '/#website', url: SITE_URL + '/', name: SITE_NAME, alternateName: ['ConexãoGamer', 'Conexao Gamer'], inLanguage: 'pt-BR', publisher: { '@id': SITE_URL + '/#organization' } },
          { '@type': 'Organization', '@id': SITE_URL + '/#organization', name: SITE_NAME, url: SITE_URL + '/', logo: { '@type': 'ImageObject', url: SITE_URL + '/logo-512x512.png', width: 512, height: 512 } }
        ]
      }
    }));
}

function buildPostPage(template, p, posts) {
  const url = SITE_URL + p.url;
  const image = absUrl(p.image);
  const title = seoTitle(p.title);
  const description = clip(p.summary || p.title, 160);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: clip(p.title, 110),
    description,
    ...(image ? { image: [image] } : {}),
    datePublished: new Date(p.time).toISOString(),
    dateModified: new Date(p.time).toISOString(),
    author: (p.authorPhoto || p.authorBio)
      ? { '@type': 'Person', name: p.author, ...(absUrl(p.authorPhoto) ? { image: absUrl(p.authorPhoto) } : {}) }
      : { '@type': 'Organization', name: p.author },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: SITE_URL + '/logo-512x512.png' } },
    mainEntityOfPage: url
  };

  let html = template
    .replace('<!--CG:HEAD-->', headTags({ title, description, url, image, type: 'article', jsonLd, rich: true }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', `<body data-slug="${esc(p.slug)}" data-page="post"`)
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => articleHtml(p, relatedPosts(p, posts || [], 3)));
  return html;
}

/* ---------- Principal ---------- */

async function main() {
  const t0 = Date.now();

  // marked pode ser ESM ou CJS conforme a versão: import() dinâmico funciona nos dois
  const markedMod = await import('marked');
  const marked = markedMod.marked || markedMod.default || markedMod;
  const mdParse = (text) => (marked.parse ? marked.parse(text) : marked(text));

  const templatePath = path.join(ROOT, 'index.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  for (const marker of ['<!--CG:HEAD-->', '<!--CG:HERO-->', '<!--CG:MAIN-->']) {
    if (!template.includes(marker)) throw new Error('index.html está sem o marcador ' + marker);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const posts = loadPosts(mdParse);
  attachAuthors(posts, loadAuthors());

  // posts.json (sem o corpo do texto: leve para a home)
  const light = posts.map((p) => ({
    slug: p.slug, url: p.url, title: p.title, summary: p.summary, image: p.image,
    categories: p.categories, tags: p.tags, rating: p.rating, author: p.author, authorPhoto: p.authorPhoto || '',
    time: p.time, readMin: p.readMin
  }));
  fs.writeFileSync(path.join(DIST, 'posts.json'), JSON.stringify(light));

  // Home
  fs.writeFileSync(path.join(DIST, 'index.html'), buildHome(template, posts));

  // Uma página por matéria
  for (const p of posts) {
    const dir = path.join(DIST, 'noticias', p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildPostPage(template, p, posts));
  }

  // Páginas fixas: Privacidade, Termos, Sobre, Contato e Política Editorial
  const contact = loadContact();
  const legalPages = LEGAL_PAGES.map((d) => loadLegalPage(d, mdParse, contact)).filter(Boolean);
  for (const pg of legalPages) {
    fs.mkdirSync(path.join(DIST, pg.slug), { recursive: true });
    fs.writeFileSync(path.join(DIST, pg.slug, 'index.html'), buildLegalPage(template, pg));
  }
  if (legalPages.length && (!contact.responsavel || !contact.email)) {
    console.warn('[build] AVISO: preencha o responsável e o e-mail de contato (painel: Configurações do site > Contato). ' +
                 'Enquanto isso, as páginas que usam esses dados (Privacidade, Termos, Sobre e Contato) mostram um aviso no lugar.');
  }

  // Página de perfil do leitor (privada: fora do Google e do sitemap)
  fs.mkdirSync(path.join(DIST, 'moderacao'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'moderacao', 'index.html'), buildModerationPage(template));
  fs.mkdirSync(path.join(DIST, 'avisos'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'avisos', 'index.html'), buildNoticesPage(template));
  fs.mkdirSync(path.join(DIST, 'newsletter'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'newsletter', 'index.html'), buildNewsletterPage(template));
  fs.mkdirSync(path.join(DIST, 'u'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'u', 'index.html'), buildPublicProfilePage(template));
  fs.mkdirSync(path.join(DIST, 'perfil'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'perfil', 'index.html'), buildProfilePage(template));

  // Página de busca (fica fora do Google e do sitemap)
  fs.mkdirSync(path.join(DIST, 'busca'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'busca', 'index.html'), buildSearchPage(template));

  // Páginas de categoria (sempre geradas, mesmo vazias, para o menu nunca dar 404)
  const catUrls = [];
  for (const cat of CATEGORIES) {
    const list = posts.filter((p) => p.categories.some((c) => cat.match.includes(c)));
    const dir = path.join(DIST, 'categoria', cat.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildCategoryPage(template, cat, list));
    if (list.length) catUrls.push({ loc: SITE_URL + '/categoria/' + cat.slug + '/', lastmod: new Date(list[0].time).toISOString().slice(0, 10) });
  }

  // sitemap.xml + robots.txt
  const urls = [{ loc: SITE_URL + '/', lastmod: posts[0] ? new Date(posts[0].time).toISOString().slice(0, 10) : null }]
    .concat(catUrls)
    .concat(legalPages.map((pg) => ({ loc: SITE_URL + pg.url, lastmod: null })))
    .concat(posts.map((p) => ({ loc: SITE_URL + p.url, lastmod: new Date(p.time).toISOString().slice(0, 10) })));
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n');
  fs.writeFileSync(path.join(DIST, 'feed.xml'), buildFeed(posts));
  fs.writeFileSync(path.join(DIST, 'llms.txt'), buildLlmsTxt(posts, legalPages));
  warnExternalCovers(posts);
  // Ícones do site na RAIZ (o Google só mostra o ícone/logo de arquivos com endereço próprio; ver favicons.js)
  let ICONS = {};
  try { ICONS = require('./favicons'); }
  catch (e) { console.warn('[build] AVISO: favicons.js não encontrado ou com erro (' + e.message + '). O ícone do site NÃO aparecerá no Google.'); }
  Object.keys(ICONS).forEach((name) => {
    const f = ICONS[name];
    fs.writeFileSync(path.join(DIST, name), f.b64 ? Buffer.from(f.b64, 'base64') : f.text);
  });
  fs.writeFileSync(path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /perfil/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // Arquivos estáticos que precisam continuar acessíveis
  const adminOut = path.join(DIST, ADMIN_PATH);
  const hasAdmin = copyDir(path.join(ROOT, 'admin'), adminOut);
  if (hasAdmin) {
    // Ajusta o admin/index.html para o endereço novo e impede a indexação no Google
    const adminIndex = path.join(adminOut, 'index.html');
    if (fs.existsSync(adminIndex)) {
      let h = fs.readFileSync(adminIndex, 'utf8');
      h = h.replace(/(href=["'])\/admin\/config\.yml(["'])/g, `$1/${ADMIN_PATH}/config.yml$2`);
      // Carrega os blocos extras do editor (imagem com legenda, YouTube, redes sociais)
      if (!/cms-components\.js/.test(h)) {
        const tag = `<script src="/${ADMIN_PATH}/cms-components.js"></script>`;
        h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, `  ${tag}\n</body>`) : h + '\n' + tag;
      }
      if (!/name=["']robots["']/i.test(h)) {
        h = h.replace(/<head>/i, '<head>\n  <meta name="robots" content="noindex, nofollow" />');
      }
      fs.writeFileSync(adminIndex, h);
    }
  }
  copyDir(path.join(ROOT, 'uploads'), path.join(DIST, 'uploads'));
  if (!hasAdmin) console.warn('[build] AVISO: pasta admin/ não encontrada - o painel do CMS não será publicado.');

  console.log(`[build] OK: ${posts.length} matéria(s), ${CATEGORIES.length} categoria(s), ${legalPages.length} página(s) fixa(s) em ${Date.now() - t0} ms`);
  posts.forEach((p) => console.log('  ' + p.url));
}

main().catch((err) => {
  console.error('[build] ERRO:', err);
  process.exit(1);
});
