/**
 * localize-images.js - baixa para uploads/ as imagens que as matérias usam por link externo
 * e troca o link no .md pelo caminho local (/uploads/arquivo.jpg).
 *
 * Roda sozinho no GitHub (veja .github/workflows/localize-images.yml) a cada publicação,
 * e também pode ser rodado à mão:   node scripts/localize-images.js
 *
 * Olha: content/posts/*.md e content/authors/*.md
 *   - campos image: (capa) e photo: (foto do autor)
 *   - imagens do texto: ![alt](https://...)  e  [[imagem|https://...|...]]
 * Se uma imagem não puder ser baixada (site fora do ar, bloqueio, arquivo grande demais),
 * o link original é mantido e o aviso aparece no log. Nada quebra.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const DIRS = ['content/posts', 'content/authors'].map((d) => path.join(ROOT, d));
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const OWN_HOSTS = (process.env.OWN_HOSTS || 'conexaogamer-seven.vercel.app').split(',').map((s) => s.trim()).filter(Boolean);

// Tipo real do arquivo pelos primeiros bytes (não confia na extensão nem no cabeçalho do site)
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 4, 8) === 'ftyp' && /avif|avis/.test(buf.toString('latin1', 8, 16))) return 'avif';
  return null;   // SVG e outros formatos ficam de fora de propósito
}

function isExternal(u) {
  let url;
  try { url = new URL(u); } catch (e) { return false; }
  if (!/^https?:$/.test(url.protocol)) return false;
  return !OWN_HOSTS.includes(url.hostname.toLowerCase());
}

function baseName(u) {
  let name = '';
  try { name = decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch (e) {}
  name = name.replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return name || 'imagem';
}

// Já existe um arquivo desta URL? (nome = nome-do-original + hash da URL)
function findExisting(hash) {
  if (!fs.existsSync(UPLOADS)) return null;
  return fs.readdirSync(UPLOADS).find((f) => f.includes('-' + hash + '.')) || null;
}

async function download(u) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConexaoGamerBot/1.0)', 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('arquivo grande demais (' + Math.round(len / 1048576) + ' MB)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('arquivo grande demais');
    const ext = sniff(buf);
    if (!ext) throw new Error('não é PNG/JPG/GIF/WEBP/AVIF');
    return { buf, ext };
  } finally { clearTimeout(timer); }
}

// Links de imagem encontrados no arquivo
function findUrls(text) {
  const found = new Set();
  const add = (u) => { u = String(u || '').trim().replace(/&amp;/g, '&'); if (isExternal(u)) found.add(u); };
  for (const m of text.matchAll(/^(?:image|photo):[ \t]*["']?(https?:\/\/[^\s"']+)["']?[ \t]*$/gim)) add(m[1]);
  for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)/g)) add(m[1]);
  for (const m of text.matchAll(/\[\[imagem\|(https?:\/\/[^|\]]+)\|/g)) add(m[1]);
  return [...found];
}

async function main() {
  const files = [];
  for (const d of DIRS) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (/\.md$/i.test(f)) files.push(path.join(d, f));

  const done = new Map();   // url -> caminho local (ou null se falhou)
  let changedFiles = 0, saved = 0, failed = 0;

  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8');
    const urls = findUrls(text);
    if (!urls.length) continue;
    let changed = false;

    for (const u of urls) {
      if (!done.has(u)) {
        const hash = crypto.createHash('sha1').update(u).digest('hex').slice(0, 10);
        let local = null;
        const existing = findExisting(hash);
        if (existing) local = '/uploads/' + existing;
        else {
          try {
            const { buf, ext } = await download(u);
            fs.mkdirSync(UPLOADS, { recursive: true });
            const name = baseName(u) + '-' + hash + '.' + ext;
            fs.writeFileSync(path.join(UPLOADS, name), buf);
            local = '/uploads/' + name;
            saved++;
            console.log('[imagens] baixada: ' + u + ' -> ' + local + ' (' + Math.round(buf.length / 1024) + ' KB)');
          } catch (e) {
            failed++;
            console.warn('[imagens] AVISO: não consegui baixar ' + u + ' (' + (e.name === 'AbortError' ? 'demorou demais' : e.message) + '). O link original foi mantido.');
          }
        }
        done.set(u, local);
      }
      const local = done.get(u);
      if (local) {
        // troca a URL como está escrita no arquivo (com & normal ou &amp;)
        const variants = new Set([u, u.replace(/&/g, '&amp;')]);
        for (const v of variants) if (text.includes(v)) { text = text.split(v).join(local); changed = true; }
      }
    }
    if (changed) { fs.writeFileSync(file, text); changedFiles++; console.log('[imagens] atualizado: ' + path.relative(ROOT, file)); }
  }
  console.log(`[imagens] fim: ${saved} baixada(s), ${failed} falha(s), ${changedFiles} arquivo(s) atualizado(s).`);
}

main().catch((e) => { console.error('[imagens] ERRO:', e); process.exit(1); });
