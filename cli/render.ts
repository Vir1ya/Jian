// 把一篇 Markdown 渲染成 Worker 能直接拼装的数据。
// 输出：正文树（锁块切开）、脚注、大纲、链接、搜索文本、图片引用、摘要。

import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import { blocksPlugin, collectBlockNames, type BlockMeta, type Problem, type RenderEnv, type Template } from './blocks.ts';
import { esc, M, FN_RE, ANY_MARK_RE, pagePath, plain, stripDetails, type Node, type PageDoc, type LinkRow, type TextRow, type ImgRefRow } from '../shared/core.ts';

export interface Resolved { name: string; grp: string }
export interface Asset { url: string; hash: string }

export interface RenderInput {
  name: string;
  body: string;
  lineOffset: number;
  grp: string;
  resolve: (target: string) => Resolved | null;
  asset: (src: string) => Asset | null;
  breaks: boolean;
  sanitize: boolean;
  templates?: Map<string, Template>;
}

export interface RenderOutput {
  tree: Node[];
  notes: string[];
  toc: PageDoc['toc'];
  links: LinkRow[];
  texts: TextRow[];
  imgrefs: ImgRefRow[];
  excerpt: string;
  problems: Problem[];
  blockNames: { name: string; line: number }[];
}

interface Env extends RenderEnv {
  problems: Problem[];
  lineOffset: number;
  notes: string[];
  toc: PageDoc['toc'];
  links: LinkRow[];
  imgrefs: ImgRefRow[];
  ids: Map<string, number>;
  input: RenderInput;
  excerptParts: string[];
}

// ---------- 行内规则：[[双链]] 与 ^[脚注] ----------

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src, pos = state.pos;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner.trim() || inner.includes('[[')) return false;
  if (!silent) {
    const t = state.push('wikilink', '', 0);
    t.meta = { raw: inner, ctx: context(src, pos, end + 2) };
  }
  state.pos = end + 2;
  return true;
}

function footnoteRule(state: StateInline, silent: boolean): boolean {
  const src = state.src, pos = state.pos;
  if (src.charCodeAt(pos) !== 0x5e || src.charCodeAt(pos + 1) !== 0x5b) return false;
  let depth = 0, i = pos + 1;
  for (; i < state.posMax; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (depth !== 0) return false;
  if (!silent) {
    const t = state.push('jfn', '', 0);
    const children: Token[] = [];
    state.md.inline.parse(src.slice(pos + 2, i), state.md, state.env, children);
    t.meta = { children };
  }
  state.pos = i + 1;
  return true;
}

/** 双链前后的一小段文字，用作反链里的上下文 */
function context(src: string, start: number, end: number): string {
  const clean = (s: string) => s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\^\[[^\]]*\]/g, '').replace(/[*_`~]/g, '');
  const before = clean(src.slice(Math.max(0, start - 60), start)).slice(-30);
  const self = clean(src.slice(start, end));
  const after = clean(src.slice(end, end + 60)).slice(0, 30);
  return ((start > 30 ? '……' : '') + before + self + after + (end + 30 < src.length ? '……' : '')).replace(/\s+/g, ' ').trim();
}

function parseWiki(raw: string): { target: string; anchor: string; text: string } {
  const bar = raw.search(/\\?\|/);
  const left = bar < 0 ? raw : raw.slice(0, bar);
  const label = bar < 0 ? '' : raw.slice(bar).replace(/^\\?\|/, '');
  const hash = left.indexOf('#');
  const target = (hash < 0 ? left : left.slice(0, hash)).trim();
  const anchor = hash < 0 ? '' : left.slice(hash + 1).trim();
  const text = label.trim() || (target ? (anchor ? `${target}#${anchor}` : target) : anchor);
  return { target, anchor, text };
}

function currentReq(env: Env): string[] {
  const s = new Set<string>();
  if (env.input.grp) s.add(env.input.grp);
  for (const g of env.lockStack) s.add(g);
  return [...s];
}

function wikiHtml(raw: string, ctx: string, env: Env, textHtml?: string): string {
  const { target, anchor, text } = parseWiki(raw);
  const label = textHtml ?? esc(text);
  const hash = anchor ? '#' + encodeURIComponent(anchor) : '';
  if (!target) return `<a class="wl" href="${hash}">${label}</a>`;
  const r = env.input.resolve(target);
  const req = JSON.stringify(currentReq(env));
  if (!r) {
    env.links.push({ src: env.input.name, dst: target, req, ctx });
    return `<a class="wl red" href="${pagePath(target)}" title="这一页还没有写">${label}</a>`;
  }
  if (r.name !== env.input.name) env.links.push({ src: env.input.name, dst: r.name, req, ctx });
  const needSeal = r.grp && r.grp !== env.input.grp && !env.lockStack.includes(r.grp);
  return `<a class="wl" href="${pagePath(r.name)}${hash}" data-peek="${esc(r.name)}">${label}</a>` + (needSeal ? M.SEAL + r.grp + M.SEAL : '');
}

// ---------- HTML 块：双链、图片、可选的过滤 ----------

function rewriteHtml(html: string, env: Env): string {
  let out = html.replace(/\[\[([^\[\]]+)\]\]/g, (_m, inner: string) => wikiHtml(inner, '', env));
  out = out.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (m, pre: string, q: string, src: string) => {
    const a = useAsset(src, env);
    return a ? `${pre}${q}${a}${q}` : m;
  });
  if (env.input.sanitize) out = sanitize(out);
  return out;
}

/** 基础过滤：去掉脚本、内联事件和 javascript: 链接。开启 sanitizeHtml 后生效 */
export function sanitize(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:/gi, '$1=$2#');
}

function useAsset(src: string, env: Env): string | null {
  if (/^([a-z]+:|\/\/|\/|#|data:)/i.test(src)) return null;
  const a = env.input.asset(decodeURI(src));
  if (!a) {
    env.problems.push({ level: 'error', line: 0, msg: `找不到图片「${src}」` });
    return null;
  }
  env.imgrefs.push({ hash: a.hash, req: JSON.stringify(currentReq(env)) });
  return a.url;
}

// ---------- 组装 markdown-it ----------

function makeMd(breaks: boolean): MarkdownIt {
  const md = new MarkdownIt({ html: true, breaks, linkify: false, typographer: false });
  md.use(blocksPlugin);
  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'jfootnote', footnoteRule);

  const r = md.renderer.rules;
  r.wikilink = (tokens, idx, _o, env) => {
    const m = tokens[idx]!.meta;
    return wikiHtml(m.raw, m.ctx, env as Env);
  };
  r.jfn = (tokens, idx, opts, envAny) => {
    const env = envAny as Env;
    const html = md.renderer.renderInline(tokens[idx]!.meta.children, opts, env);
    env.notes.push(html);
    return M.FN + (env.notes.length - 1) + M.FN;
  };

  const defaultHeading = r.heading_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
  r.heading_open = (tokens, idx, opts, envAny, self) => {
    const env = envAny as Env;
    const tok = tokens[idx]!;
    const inline = tokens[idx + 1]!;
    // 先把标题文字渲染出来再取纯文字；这里不能记录链接，否则会重复
    const scratch = { ...env, links: [], notes: [], imgrefs: [], problems: [] } as Env;
    const text = plain(md.renderer.renderInline(inline.children ?? [], opts, scratch).replace(ANY_MARK_RE, ''));
    let id = text.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '') || 'h';
    const n = env.ids.get(id) ?? 0;
    env.ids.set(id, n + 1);
    if (n) id = `${id}-${n + 1}`;
    tok.attrSet('id', id);
    const level = +tok.tag.slice(1);
    const inBody = env.blkStack.every((n) => n === '锁' || n === '段');
    if ((level === 2 || level === 3) && env.foldDepth === 0 && inBody) {
      env.toc.push({ l: level, t: text, id, req: currentReq(env) });
    }
    return defaultHeading(tokens, idx, opts, env, self);
  };

  r.paragraph_open = (tokens, idx, opts, envAny, self) => {
    const env = envAny as Env;
    const inline = tokens[idx + 1];
    if (inline && env.blkStack.length === 0 && env.lockStack.length === 0 && env.foldDepth === 0 && env.excerptParts.join('').length < 200) {
      const scratch = { ...env, links: [], notes: [], imgrefs: [], problems: [] } as Env;
      const t = plain(md.renderer.renderInline((inline.children ?? []).filter((c) => c.type !== 'jfn'), opts, scratch)).replace(ANY_MARK_RE, '');
      if (t) env.excerptParts.push(t);
    }
    return self.renderToken(tokens, idx, opts);
  };

  const defaultImage = r.image!;
  r.image = (tokens, idx, opts, envAny, self) => {
    const env = envAny as Env;
    const tok = tokens[idx]!;
    const url = useAsset(tok.attrGet('src') ?? '', env);
    if (url) tok.attrSet('src', url);
    tok.attrSet('loading', 'lazy');
    tok.attrSet('decoding', 'async');
    return defaultImage(tokens, idx, opts, env, self);
  };
  return md;
}

const mdCache = new Map<boolean, MarkdownIt>();

// ---------- 把带锁标记的 HTML 切成树 ----------

export function toTree(html: string): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  const re = /([\s\S]*?)|/g;
  let last = 0, m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (!s) return;
    const top = stack[stack.length - 1]!;
    const prev = top[top.length - 1];
    if (typeof prev === 'string') top[top.length - 1] = prev + s; else top.push(s);
  };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      const { g, s } = JSON.parse(m[1]);
      const node = { g, s, c: [] as Node[] };
      stack[stack.length - 1]!.push(node);
      stack.push(node.c);
    } else if (stack.length > 1) {
      stack.pop();
    }
  }
  pushText(html.slice(last));
  return root;
}

function noteText(notes: string[]): (s: string) => string {
  return (s) => s.replace(FN_RE, (_m, i) => ' ' + (notes[+i] ?? '') + ' ');
}

/** 每个锁层级一段搜索文本 */
function searchTexts(tree: Node[], base: string[], notes: string[], page: string): TextRow[] {
  const out: TextRow[] = [];
  const withNotes = noteText(notes);
  const walk = (nodes: Node[], req: string[]) => {
    let buf = '';
    for (const n of nodes) {
      if (typeof n === 'string') buf += n;
      else walk(n.c, req.includes(n.g) ? req : [...req, n.g]);
    }
    const body = plain(withNotes(buf)).replace(ANY_MARK_RE, '');
    if (body) out.push({ page, req: JSON.stringify(req), body });
  };
  walk(tree, base);
  return out;
}

function excerptOf(tree: Node[], parts: string[]): string {
  if (parts.length) {
    const t = parts.join(' ');
    return t.length > 120 ? t.slice(0, 120) + '……' : t;
  }
  const top = tree.filter((n): n is string => typeof n === 'string').join(' ');
  const text = plain(stripDetails(top).replace(FN_RE, '')).replace(ANY_MARK_RE, '');
  return text.length > 120 ? text.slice(0, 120) + '……' : text;
}

export function renderPage(input: RenderInput): RenderOutput {
  let md = mdCache.get(input.breaks);
  if (!md) { md = makeMd(input.breaks); mdCache.set(input.breaks, md); }

  const env: Env = {
    problems: [], lineOffset: input.lineOffset, notes: [], toc: [], links: [], imgrefs: [], ids: new Map(), excerptParts: [],
    lockStack: [], foldDepth: 0, blkStack: [], pagePath: pagePath(input.name), input,
    renderRaw: (meta: BlockMeta, content: string) => {
      if (meta.type === 'text') return esc(content);
      return rewriteHtml(content, env);
    },
    templates: input.templates ?? new Map(),
    renderTpl: (html: string) => rewriteHtml(html, env),
  };
  const tokens = md.parse(input.body, env);
  const html = md.renderer.render(tokens, md.options, env);
  const tree = toTree(html);
  const base = input.grp ? [input.grp] : [];
  return {
    tree,
    notes: env.notes,
    toc: env.toc,
    links: env.links,
    texts: searchTexts(tree, base, env.notes, input.name),
    imgrefs: env.imgrefs,
    excerpt: excerptOf(tree, env.excerptParts),
    problems: env.problems,
    blockNames: collectBlockNames(tokens),
  };
}
