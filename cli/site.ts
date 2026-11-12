// 读取整个站点：content/ 下的文章、assets/ 里的图片、theme/ 里的样式和片段、jian.config.json。
// 两遍处理：第一遍收集所有页面名（双链要知道目标存不存在、有没有锁），第二遍渲染。

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import { renderPage, type Resolved } from './render.ts';
import { BUILTIN_NAMES, compileTemplate, type Problem, type Template } from './blocks.ts';
import { mergeConfig, type SiteConfig, type PageRow, type LinkRow, type TextRow, type ImgRefRow, type PageDoc } from '../shared/core.ts';

export const HOME = '_home';

export interface FileProblem extends Problem { file: string }

export interface Blob { hash: string; path: string; type: string; size: number }

export interface Snapshot {
  config: SiteConfig;
  customCss: string;
  snippets: { head: string; header: string; footer: string };
  pages: PageRow[];
  links: LinkRow[];
  texts: TextRow[];
  imgrefs: ImgRefRow[];
  blobs: Map<string, Blob>;
  groups: Set<string>;
  problems: FileProblem[];
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

interface Source {
  file: string;
  rel: string;
  name: string;
  fm: Record<string, any>;
  body: string;
  lineOffset: number;
  mtime: Date;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

function splitFrontmatter(text: string): { fm: Record<string, any>; body: string; lineOffset: number; error?: string } {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(text);
  if (!m) return { fm: {}, body: text, lineOffset: 0 };
  try {
    const fm = YAML.parse(m[1]!) ?? {};
    if (typeof fm !== 'object' || Array.isArray(fm)) return { fm: {}, body: text, lineOffset: 0, error: '开头的元信息格式不对' };
    return { fm, body: text.slice(m[0].length), lineOffset: m[0].split('\n').length - 1 };
  } catch (e: any) {
    return { fm: {}, body: text.slice(m[0].length), lineOffset: m[0].split('\n').length - 1, error: '开头的元信息写错了：' + String(e.message).split('\n')[0] };
  }
}

function isoDate(v: unknown, fallback: Date): string {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = fallback;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function readText(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function loadSite(root: string): Snapshot {
  const problems: FileProblem[] = [];
  const cfgPath = join(root, 'jian.config.json');
  let userCfg: unknown = {};
  if (existsSync(cfgPath)) {
    try { userCfg = JSON.parse(readFileSync(cfgPath, 'utf8')); }
    catch (e: any) { problems.push({ file: 'jian.config.json', line: 0, level: 'error', msg: '不是合法的 JSON：' + e.message }); }
  }
  const config = mergeConfig(userCfg);
  if (config.blocks !== 1) problems.push({ file: 'jian.config.json', line: 0, level: 'error', msg: `这个版本只支持块协议 1，配置里写的是 ${config.blocks}` });

  const contentDir = join(root, 'content');
  const assetsDir = join(root, 'assets');
  const themeDir = join(root, 'theme');
  const customCss = readText(join(themeDir, 'custom.css'));
  const templates = new Map<string, Template>();
  const blocksDir = join(themeDir, 'blocks');
  if (existsSync(blocksDir)) {
    for (const f of readdirSync(blocksDir).sort()) {
      if (!f.endsWith('.html')) continue;
      const name = basename(f, '.html');
      const rel = `theme/blocks/${f}`;
      if (!/^[\p{L}\p{N}_-]+$/u.test(name)) { problems.push({ file: rel, line: 0, level: 'error', msg: '模板文件名就是块名，只能用文字、数字、- 和 _' }); continue; }
      const t = compileTemplate(readFileSync(join(blocksDir, f), 'utf8').replace(/\r\n?/g, '\n'));
      if (typeof t === 'string') problems.push({ file: rel, line: 0, level: 'error', msg: t });
      else templates.set(name, t);
    }
  }
  const snippets = {
    head: readText(join(themeDir, 'head.html')),
    header: readText(join(themeDir, 'header.html')),
    footer: readText(join(themeDir, 'footer.html')),
  };

  // ---------- 第一遍：收集页面 ----------
  const sources: Source[] = [];
  const byName = new Map<string, Source>();
  for (const file of walk(contentDir)) {
    const rel = relative(root, file).split(sep).join('/');
    const fr = splitFrontmatter(readFileSync(file, 'utf8'));
    if (fr.error) problems.push({ file: rel, line: 1, level: 'error', msg: fr.error });
    const stem = basename(file, extname(file));
    const isHome = relative(contentDir, file) === 'index.md';
    const name = isHome ? HOME : stem.trim();
    if (!isHome) {
      if (name.startsWith('_')) { problems.push({ file: rel, line: 0, level: 'error', msg: '文件名不能以 _ 开头，这是系统保留的' }); continue; }
      if (/[\/\\#?%]/.test(name)) { problems.push({ file: rel, line: 0, level: 'error', msg: '文件名里不能有 / \\ # ? %' }); continue; }
    }
    const prev = byName.get(name);
    if (prev) { problems.push({ file: rel, line: 0, level: 'error', msg: `页面名「${name}」和 ${prev.rel} 重复了，双链会分不清` }); continue; }
    const src: Source = { file, rel, name, fm: fr.fm, body: fr.body, lineOffset: fr.lineOffset, mtime: statSync(file).mtime };
    sources.push(src);
    byName.set(name, src);
  }

  // 名字、标题、别名都能用来写双链
  const lookup = new Map<string, Resolved>();
  const keyOf = (s: string) => s.trim().toLowerCase();
  for (const s of sources) {
    if (s.name === HOME) continue;
    lookup.set(keyOf(s.name), { name: s.name, grp: String(s.fm.lock ?? '').trim() });
  }
  for (const s of sources) {
    if (s.name === HOME) continue;
    const r = lookup.get(keyOf(s.name))!;
    for (const alt of [s.fm.title, ...list(s.fm.aliases)]) {
      if (!alt) continue;
      const k = keyOf(String(alt));
      const hit = lookup.get(k);
      if (hit && hit.name !== s.name) {
        if (keyOf(hit.name) === k) problems.push({ file: s.rel, line: 1, level: 'warn', msg: `标题或别名「${alt}」和页面「${hit.name}」同名，双链会指向那一页` });
        continue;
      }
      lookup.set(k, r);
    }
  }
  const resolveTarget = (t: string) => lookup.get(keyOf(t)) ?? null;

  // ---------- 图片 ----------
  const blobs = new Map<string, Blob>();
  const assetCache = new Map<string, { url: string; hash: string } | null>();
  const makeAsset = (fromFile: string) => (src: string) => {
    const candidates = [resolve(dirname(fromFile), src), resolve(assetsDir, src), resolve(contentDir, src)];
    const path = candidates.find((p) => existsSync(p) && statSync(p).isFile());
    if (!path) return null;
    if (assetCache.has(path)) return assetCache.get(path)!;
    const ext = extname(path).toLowerCase();
    const type = MIME[ext];
    if (!type) { assetCache.set(path, null); return null; }
    const buf = readFileSync(path);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 20);
    blobs.set(hash, { hash, path, type, size: buf.length });
    const a = { url: `/_img/${hash}${ext}`, hash };
    assetCache.set(path, a);
    return a;
  };

  // ---------- 第二遍：渲染 ----------
  const pages: PageRow[] = [];
  const links: LinkRow[] = [];
  const texts: TextRow[] = [];
  const imgrefs: ImgRefRow[] = [];
  const groups = new Set<string>();
  const styled = new Set<string>();
  for (const m of customCss.matchAll(/\.blk-([\p{L}\p{N}_-]+)/gu)) styled.add(m[1]!);
  for (const n of templates.keys()) styled.add(n);
  const unstyledWarned = new Set<string>();

  for (const s of sources) {
    const fm = s.fm;
    const grp = String(fm.lock ?? '').trim();
    if (grp) groups.add(grp);
    const asset = makeAsset(s.file);
    const out = renderPage({
      name: s.name, body: s.body, lineOffset: s.lineOffset, grp,
      resolve: resolveTarget, asset, breaks: config.markdown.breaks, sanitize: config.sanitizeHtml, templates,
    });
    for (const p of out.problems) problems.push({ ...p, file: s.rel });
    for (const b of out.blockNames) {
      if (BUILTIN_NAMES.has(b.name) || styled.has(b.name) || unstyledWarned.has(b.name)) continue;
      unstyledWarned.add(b.name);
      problems.push({ file: s.rel, line: b.line, level: 'warn', msg: `块「${b.name}」在 theme/custom.css 里没有样式，也没有模板，会显示成普通段落` });
    }
    for (const n of out.texts) for (const g of JSON.parse(n.req)) groups.add(g);

    let cover = '';
    if (fm.cover) {
      const a = asset(String(fm.cover));
      if (a) { cover = a.url; imgrefs.push({ hash: a.hash, req: JSON.stringify(grp ? [grp] : []) }); }
      else problems.push({ file: s.rel, line: 1, level: 'error', msg: `找不到封面图「${fm.cover}」` });
    }
    const layout = ['narrow', 'wide', 'full'].includes(fm.layout) ? fm.layout : 'narrow';
    if (fm.layout && layout !== fm.layout) problems.push({ file: s.rel, line: 1, level: 'warn', msg: `layout 只能是 narrow、wide 或 full，「${fm.layout}」按 narrow 处理` });

    const doc: PageDoc = {
      tree: out.tree, notes: out.notes, toc: out.toc, layout,
      cls: list(fm.class).join(' ').replace(/[^\p{L}\p{N}_\- ]/gu, ''),
      css: typeof fm.css === 'string' ? fm.css : '',
      cover, showToc: fm.toc !== false, showBack: fm.backlinks !== false,
    };
    const folder = s.name === HOME ? '' : dirname(relative(contentDir, s.file)).split(sep).join('/').replace(/^\.$/, '');
    pages.push({
      name: s.name,
      title: String(fm.title ?? (s.name === HOME ? config.title : s.name)),
      grp,
      tags: JSON.stringify(list(fm.tags)),
      updated: isoDate(fm.updated ?? fm.date, s.mtime),
      folder,
      excerpt: out.excerpt,
      doc: JSON.stringify(doc),
    });
    links.push(...out.links);
    texts.push(...out.texts.map((t) => ({ ...t, body: (t.req === '[]' || t.req === JSON.stringify([grp]) ? String(fm.title ?? '') + ' ' : '') + t.body })));
    imgrefs.push(...out.imgrefs);
  }

  for (const b of blobs.values()) {
    if (b.size > 20 * 1024 * 1024) problems.push({ file: relative(root, b.path), line: 0, level: 'error', msg: '图片超过 20 MB，太大了' });
  }

  return { config, customCss, snippets, pages, links, texts, imgrefs, blobs, groups, problems };
}
