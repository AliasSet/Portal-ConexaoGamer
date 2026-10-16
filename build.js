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

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const AUTHORS_DIR = path.join(ROOT, 'content', 'authors');
const SITE_NAME = 'Conexão Gamer';

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
    html: mdParse(body)
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

function articleHtml(p) {
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
                    ${okImg(p.image) ? `<figure class="mt-6"><img src="${esc(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer" class="w-full max-h-[420px] object-cover rounded-2xl border border-gray-800" onerror="this.style.display='none'">${caption ? `<figcaption class="mt-2 text-xs text-gray-500 leading-relaxed">${caption}</figcaption>` : ''}</figure>` : ''}
                    <div class="article-body mt-6">${bodyHtml}</div>
                    ${tags ? `<div class="flex flex-wrap gap-2 mt-8">${tags}</div>` : ''}
                    ${p.authorBio ? `<aside class="mt-8 flex gap-4 bg-gray-900 border border-gray-800 rounded-2xl p-5" aria-label="Sobre o autor">
                        ${p.authorPhoto ? authorImg(p, 'w-14 h-14') : '<span class="w-14 h-14 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-user text-cyan-400"></i></span>'}
                        <div class="min-w-0">
                            <p class="text-[10px] uppercase tracking-widest text-cyan-400 font-extrabold">Sobre o autor</p>
                            <p class="text-sm font-bold text-white mt-0.5">${esc(p.author)}</p>
                            <p class="text-xs text-gray-400 mt-1 leading-relaxed">${esc(p.authorBio)}</p>
                        </div>
                    </aside>` : ''}

                    <section id="comments" class="mt-10 pt-8 border-t border-gray-800 scroll-mt-24">
                        <h2 class="text-lg font-black text-white flex items-center gap-2"><i class="fa-regular fa-comments text-cyan-400"></i> Comentários <span id="comments-count" class="text-xs font-semibold text-gray-500"></span></h2>
                        <div id="comment-form-area" class="mt-4"><p class="text-sm text-gray-500">Carregando…</p></div>
                        <div id="comments-list" class="mt-6 space-y-5"><p class="text-sm text-gray-500">Carregando comentários…</p></div>
                        <button id="comments-more" type="button" class="hidden mt-6 text-xs font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-5 py-2.5 rounded-xl transition">Carregar mais comentários</button>
                    </section>
                </article>
                `;
}

const fmtDateShort = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' });

function cardHtml(p) {
  const cats = (p.categories.length ? p.categories : ['Notícias'])
    .map((c) => `<span class="border text-[10px] font-bold px-2.5 py-0.5 rounded uppercase ${catStyle(c)}">${esc(c)}</span>`).join('');
  return `
                        <a href="${esc(p.url)}" class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden card-hover flex flex-col group">
                            <div class="relative h-48 overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950">
                                ${okImg(p.image) ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.style.display='none'">` : ''}
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
                    <div class="border-b border-gray-800 pb-3 mb-6">
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

                    <div id="profile-user" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
                        <div class="flex items-center gap-4 pb-6 border-b border-gray-800">
                            <div id="profile-avatar" class="relative w-20 h-20 rounded-full overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center text-2xl font-black text-cyan-400 flex-shrink-0"></div>
                            <div class="min-w-0">
                                <p id="profile-title" class="text-lg font-black text-white truncate"></p>
                                <p id="profile-since" class="text-xs text-gray-500 mt-1"></p>
                                <div class="mt-3 flex flex-wrap items-center gap-2">
                                    <button id="profile-photo-btn" type="button" class="text-[11px] font-bold border border-gray-700 hover:border-cyan-400 hover:text-cyan-400 text-gray-300 px-3 py-1.5 rounded-lg transition"><i class="fa-solid fa-camera mr-1"></i> Alterar foto</button>
                                    <button id="profile-photo-remove" type="button" class="hidden text-[11px] font-bold text-gray-500 hover:text-red-400 px-2 py-1.5 transition">Remover foto</button>
                                    <input id="profile-photo-input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
                                </div>
                                <p id="profile-photo-msg" class="text-[11px] mt-2 min-h-[1rem]" role="status" aria-live="polite"></p>
                            </div>
                        </div>

                        <form id="profile-form" class="py-6 space-y-3 border-b border-gray-800" novalidate>
                            <label for="profile-name" class="block text-xs font-bold text-gray-300">Nome de exibição</label>
                            <p class="text-[11px] text-gray-500">É o nome que aparece nos seus comentários. Evite usar o seu e-mail.</p>
                            <div class="flex flex-col sm:flex-row gap-3">
                                <input id="profile-name" type="text" maxlength="40" autocomplete="nickname" class="flex-1 bg-gray-950 border border-gray-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-cyan-400">
                                <button id="profile-save" type="submit" class="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 text-black font-extrabold text-xs px-6 py-3 rounded-xl transition">Salvar</button>
                            </div>
                            <p id="profile-msg" class="text-xs min-h-[1rem]" role="status" aria-live="polite"></p>
                        </form>

                        <dl class="py-6 space-y-4 text-xs border-b border-gray-800">
                            <div>
                                <dt class="text-gray-500">E-mail <span class="text-gray-600">(só você vê)</span></dt>
                                <dd id="profile-email" class="text-gray-200 mt-1 break-all"></dd>
                            </div>
                            <div>
                                <dt class="text-gray-500">Entrou com</dt>
                                <dd id="profile-provider" class="text-gray-200 mt-1"></dd>
                            </div>
                        </dl>

                        <div class="pt-6">
                            <button type="button" onclick="logout()" class="inline-flex items-center gap-2 border border-gray-700 hover:border-red-400 hover:text-red-400 text-gray-300 text-xs font-bold px-5 py-2.5 rounded-xl transition">
                                <i class="fa-solid fa-arrow-right-from-bracket"></i> Sair da conta
                            </button>
                        </div>

                        <div class="mt-8 pt-6 border-t border-gray-800">
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
                `;
}

/* ---------- Páginas fixas: Privacidade e Termos ---------- */

const LEGAL_PAGES = [
  { slug: 'privacidade', file: 'privacidade.md', fallbackTitle: 'Política de Privacidade' },
  { slug: 'termos', file: 'termos.md', fallbackTitle: 'Termos de Uso' }
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
  const title = pg.title + ' | ' + SITE_NAME;
  const main = `
                <article class="pb-8">
                    <h1 class="text-3xl sm:text-4xl font-black text-white leading-tight">${esc(pg.title)}</h1>
                    ${pg.updated ? `<p class="text-xs text-gray-500 mt-2">Última atualização: ${esc(pg.updated)}</p>` : ''}
                    <div class="article-body mt-6">${pg.html}</div>
                </article>
                `;
  return template
    .replace('<!--CG:HEAD-->', headTags({ title, description: pg.description || pg.title, url, image: '', type: 'website' }))
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
      title, description: 'Área restrita.', url: SITE_URL + '/moderacao/', image: '', type: 'website'
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
      title, description: cat.desc, url, image: withImg ? absUrl(withImg.image) : '', type: 'website'
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="category"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => categoryHtml(cat, list));
}

function headTags({ title, description, url, image, type, jsonLd }) {
  const lines = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
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
  return lines.join('\n    ');
}

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

function buildHome(template, posts) {
  const first = posts.find((p) => absUrl(p.image));
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title: SITE_NAME + ' | Portal de Notícias, Reviews e Lançamentos',
      description: 'Sua conexão com o universo dos games: lançamentos, notícias em tempo real, reviews e tudo sobre tecnologia.',
      url: SITE_URL + '/',
      image: first ? absUrl(first.image) : '',
      type: 'website'
    }));
}

function buildPostPage(template, p) {
  const url = SITE_URL + p.url;
  const image = absUrl(p.image);
  const title = p.title + ' | ' + SITE_NAME;
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
    publisher: { '@type': 'Organization', name: SITE_NAME },
    mainEntityOfPage: url
  };

  let html = template
    .replace('<!--CG:HEAD-->', headTags({ title, description, url, image, type: 'article', jsonLd }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', `<body data-slug="${esc(p.slug)}" data-page="post"`)
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => articleHtml(p));
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
    fs.writeFileSync(path.join(dir, 'index.html'), buildPostPage(template, p));
  }

  // Páginas fixas: Política de Privacidade e Termos de Uso
  const contact = loadContact();
  const legalPages = LEGAL_PAGES.map((d) => loadLegalPage(d, mdParse, contact)).filter(Boolean);
  for (const pg of legalPages) {
    fs.mkdirSync(path.join(DIST, pg.slug), { recursive: true });
    fs.writeFileSync(path.join(DIST, pg.slug, 'index.html'), buildLegalPage(template, pg));
  }
  if (legalPages.length && (!contact.responsavel || !contact.email)) {
    console.warn('[build] AVISO: preencha o responsável e o e-mail de contato (painel: Configurações do site > Contato). ' +
                 'Enquanto isso, as páginas de Privacidade e Termos mostram um aviso no lugar.');
  }

  // Página de perfil do leitor (privada: fora do Google e do sitemap)
  fs.mkdirSync(path.join(DIST, 'moderacao'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'moderacao', 'index.html'), buildModerationPage(template));
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
