// 块协议 v1 的解析器（markdown-it 插件）。
// 协议全文见方案书「附：块协议 v1」。这里是它唯一的实现。

import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import { esc, M } from '../shared/core.ts';

export const MAX_DEPTH = 4;

/** 一个块解析后的全部信息 */
export interface BlockMeta {
  name: string;
  type: 'md' | 'html' | 'text';
  lock: string;
  fold: string;
  width: string; // '' 表示全宽；否则如 '1/2'
  cols: number;
  id: string;
  cls: string[];
  data: [string, string][]; // 自定义参数，按书写顺序
  line: number;
}

export interface Problem { level: 'error' | 'warn'; line: number; msg: string }

const NAME_RE = /^[\p{L}\p{N}_-]+$/u;
const KEY_RE = /^[\p{L}\p{N}_-]+$/u;

/** 保留名：系统输出契约里用到的 class，不能当块名 */
const RESERVED = new Set(['sealed', 'row', 'text', 'html', 'md']);

/** 内置块：英文别名 → 中文名 */
const BUILTIN: Record<string, string> = {
  锁: '锁', lock: '锁',
  剧透: '剧透', spoiler: '剧透',
  栅格: '栅格', grid: '栅格',
  段: '段',
};
export const BUILTIN_NAMES = new Set(Object.values(BUILTIN));

/** 系统参数：中英两种写法 → 内部名 */
const SYS: Record<string, keyof BlockMeta> = {
  锁: 'lock', lock: 'lock',
  折叠: 'fold', fold: 'fold',
  宽: 'width', width: 'width',
  列: 'cols', cols: 'cols',
  id: 'id',
  class: 'cls',
};

const WIDTH_WORDS: Record<string, string> = {
  全: '', '1': '', '1/1': '',
  半: '1/2', 二分之一: '1/2',
  三分之一: '1/3', 三分之二: '2/3',
  四分之一: '1/4', 四分之三: '3/4',
};

type Param = { key: string | null; value: string };

/** 把 `键=值 键="带 空格" 单词` 拆成参数表。出错时返回字符串说明 */
export function parseParams(src: string): Param[] | string {
  const out: Param[] = [];
  let i = 0;
  const readQuoted = (): string | null => {
    // 调用时 src[i] === '"'
    let v = '';
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\' && i + 1 < src.length) { v += src[i + 1]; i += 2; continue; }
      if (c === '"') { i++; return v; }
      v += c; i++;
    }
    return null;
  };
  while (i < src.length) {
    if (/\s/.test(src[i]!)) { i++; continue; }
    if (src[i] === '"') {
      const v = readQuoted();
      if (v === null) return '引号没有关上';
      out.push({ key: null, value: v });
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s="]/.test(src[j]!)) j++;
    const word = src.slice(i, j);
    i = j;
    if (src[i] === '=') {
      if (!KEY_RE.test(word)) return `参数名「${word}」只能用文字、数字、- 和 _`;
      i++;
      if (src[i] === '"') {
        const v = readQuoted();
        if (v === null) return `参数「${word}」的引号没有关上`;
        out.push({ key: word, value: v });
      } else {
        let k = i;
        while (k < src.length && !/\s/.test(src[k]!)) k++;
        const v = src.slice(i, k);
        if (v.includes('"')) return `参数「${word}」的值里有多余的引号`;
        out.push({ key: word, value: v });
        i = k;
      }
    } else if (src[i] === '"') {
      return `「${word}」后面的引号位置不对`;
    } else {
      if (!word) return '参数写法不对';
      out.push({ key: null, value: word });
    }
  }
  return out;
}

function normWidth(v: string): string | null {
  if (v in WIDTH_WORDS) return WIDTH_WORDS[v]!;
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (!m) return null;
  const a = +m[1]!, b = +m[2]!;
  if (!b || a <= 0 || a > b) return null;
  return a === b ? '' : `${a}/${b}`;
}

/** 解析开头那一行。返回 null 表示这不是块的开头 */
export function parseOpener(line: string, lineNo: number): { colons: number; meta: BlockMeta } | { colons: number; error: string } | null {
  const m = /^(:{3,})[ \t]*(\S.*)?$/.exec(line);
  if (!m || !m[2]) return null; // 只有冒号的是结束行
  const colons = m[1]!.length;
  const rest = m[2].trimEnd();
  const sp = rest.search(/\s/);
  const rawName = sp < 0 ? rest : rest.slice(0, sp);
  const paramSrc = sp < 0 ? '' : rest.slice(sp + 1);
  if (!NAME_RE.test(rawName)) return { colons, error: `块名「${rawName}」只能用文字、数字、- 和 _` };
  if (RESERVED.has(rawName)) return { colons, error: `「${rawName}」是保留字，不能当块名` };

  const params = parseParams(paramSrc);
  if (typeof params === 'string') return { colons, error: params };

  const builtin = BUILTIN[rawName];
  const meta: BlockMeta = {
    name: builtin ?? rawName, type: 'md', lock: '', fold: '', width: '', cols: 0,
    id: '', cls: [], data: [], line: lineNo,
  };
  const positional: string[] = [];
  for (const p of params) {
    if (p.key === null) {
      if (p.value === 'md' || p.value === 'html' || p.value === 'text') { meta.type = p.value; continue; }
      positional.push(p.value);
      continue;
    }
    const sys = SYS[p.key];
    if (!sys) { meta.data.push([p.key, p.value]); continue; }
    if (sys === 'width') {
      const w = normWidth(p.value);
      if (w === null) return { colons, error: `宽=${p.value} 不认识，可以写 全、半、三分之一、三分之二、四分之一，或 1/2 这样的分数` };
      meta.width = w;
    } else if (sys === 'cols') {
      if (!/^[1-6]$/.test(p.value)) return { colons, error: `列=${p.value} 不对，只能是 1 到 6` };
      meta.cols = +p.value;
    } else if (sys === 'cls') {
      for (const c of p.value.split(/\s+/).filter(Boolean)) {
        if (!NAME_RE.test(c)) return { colons, error: `class「${c}」只能用文字、数字、- 和 _` };
        meta.cls.push(c);
      }
    } else if (sys === 'id') {
      if (!NAME_RE.test(p.value)) return { colons, error: `id「${p.value}」只能用文字、数字、- 和 _` };
      meta.id = p.value;
    } else if (sys === 'lock') {
      if (!p.value) return { colons, error: '锁= 后面要写组名' };
      meta.lock = p.value;
    } else if (sys === 'fold') {
      meta.fold = p.value || '展开';
    }
  }

  // 内置块把第一个位置参数当作自己的值
  if (meta.name === '锁') {
    const g = positional.shift();
    if (!g && !meta.lock) return { colons, error: '锁块要写组名，例如 :::锁 组甲' };
    if (g) meta.lock = g;
  } else if (meta.name === '剧透') {
    const t = positional.shift();
    meta.fold = t || meta.fold || '剧透';
  } else if (meta.name === '栅格') {
    if (!meta.cols) meta.cols = 2;
  }
  // 其余的单词是开关：单词 = 单词=是
  for (const f of positional) {
    if (!KEY_RE.test(f)) return { colons, error: `「${f}」不是合法的开关名` };
    meta.data.push([f, '是']);
  }
  if (meta.type !== 'md' && meta.name === '栅格') return { colons, error: '栅格块里只能放 Markdown' };
  return { colons, meta };
}

interface Env {
  problems: Problem[];
  lineOffset: number;
  blkDepth?: number;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
}

function blockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine);
  if (!first.startsWith(':::')) return false;
  const env = state.env as Env;
  const lineNo = startLine + 1 + (env.lineOffset ?? 0);
  const op = parseOpener(first, lineNo);
  if (!op) return false;
  if (silent) return true;

  // 找结束行：恰好同样数量的冒号；跳过代码块里的内容
  let close = -1, fence = '';
  for (let l = startLine + 1; l < endLine; l++) {
    if (state.sCount[l]! < state.blkIndent && lineText(state, l).length) break;
    const t = lineText(state, l);
    const fm = /^(`{3,}|~{3,})/.exec(t);
    if (fm) {
      if (!fence) fence = fm[1]!;
      else if (t.startsWith(fence) && /^[`~]+\s*$/.test(t)) fence = '';
      continue;
    }
    if (fence) continue;
    const cm = /^(:{3,})\s*$/.exec(t);
    if (cm && cm[1]!.length === op.colons) { close = l; break; }
  }

  if ('error' in op) {
    env.problems.push({ level: 'error', line: lineNo, msg: op.error });
  }
  if (close < 0) {
    env.problems.push({ level: 'error', line: lineNo, msg: `这个块没有结束行（应该是单独一行 ${':'.repeat(op.colons)}）` });
    return false;
  }
  if ('error' in op) {
    // 出错的块整个跳过，推送会被拦下
    state.line = close + 1;
    return true;
  }

  const meta = op.meta;
  const depth = (env.blkDepth ?? 0) + 1;
  if (depth > MAX_DEPTH) {
    env.problems.push({ level: 'error', line: lineNo, msg: `块嵌套超过了 ${MAX_DEPTH} 层` });
    state.line = close + 1;
    return true;
  }

  const open = state.push('blk_open', 'div', 1);
  open.meta = meta;
  open.block = true;
  open.map = [startLine, close + 1];

  if (meta.type === 'md') {
    const oldParent = state.parentType, oldMax = state.lineMax;
    state.parentType = 'container' as any;
    state.lineMax = close;
    env.blkDepth = depth;
    state.md.block.tokenize(state, startLine + 1, close);
    env.blkDepth = depth - 1;
    state.parentType = oldParent;
    state.lineMax = oldMax;
  } else {
    const raw = state.push('blk_raw', '', 0);
    raw.meta = meta;
    const lines: string[] = [];
    for (let l = startLine + 1; l < close; l++) {
      lines.push(state.src.slice(state.bMarks[l]! + Math.min(state.tShift[l]!, state.blkIndent), state.eMarks[l]));
    }
    raw.content = lines.join('\n');
  }

  const end = state.push('blk_close', 'div', -1);
  end.meta = meta;
  end.block = true;
  state.line = close + 1;
  return true;
}

// ---------- 块模板（theme/blocks/块名.html） ----------
//
// 模板只改块「里面」的结构，外层 <div class="blk blk-名字"> 不变（输出契约第 5 节）。
//   {{内容}}              块正文渲染后的位置，必须恰好出现一次
//   {{参数}}              自定义参数的值（已转义）；{{名字}} 是块名
//   {{#参数}}…{{/参数}}   写了这个参数才输出
//   {{^参数}}…{{/参数}}   没写这个参数才输出
// 模板里可以写 [[双链]]，例如 [[{{署名}}]]

export interface Template { before: string; after: string }

const SLOT = '{{内容}}';
const VAR_RE = /\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu;
const SECTION_RE = /\{\{([#^])\s*([\p{L}\p{N}_-]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/u;

export function compileTemplate(text: string): Template | string {
  const n = text.split(SLOT).length - 1;
  if (n !== 1) return n === 0 ? '模板里要有一个 {{内容}}，标出正文放在哪里' : '模板里的 {{内容}} 只能出现一次';
  const [before, after] = text.split(SLOT) as [string, string];
  for (const part of [before, after]) {
    let rest = part, guard = 0;
    while (SECTION_RE.test(rest) && guard++ < 100) rest = rest.replace(SECTION_RE, '$3');
    const stray = /\{\{\s*[#^/][^}]*\}\}/.exec(rest);
    if (stray) return `「${stray[0]}」没有配对，或者跨过了 {{内容}}`;
  }
  return { before: before.replace(/\s+$/, ''), after: after.replace(/^\s+/, '') };
}

export function fillTemplate(part: string, meta: BlockMeta): string {
  const vals = new Map<string, string>([['名字', meta.name], ...meta.data]);
  let out = part, m: RegExpExecArray | null, guard = 0;
  while ((m = SECTION_RE.exec(out)) && guard++ < 200) {
    const has = !!vals.get(m[2]!);
    const keep = m[1] === '#' ? has : !has;
    out = out.slice(0, m.index) + (keep ? m[3] : '') + out.slice(m.index + m[0].length);
  }
  return out.replace(VAR_RE, (_x, k: string) => esc(vals.get(k) ?? ''));
}

/** 渲染时需要的上下文 */
export interface RenderEnv {
  lockStack: string[];
  foldDepth: number;
  blkStack: string[];
  pagePath: string;
  /** 渲染 html/text 块的内容（双链、图片在这里处理） */
  renderRaw: (meta: BlockMeta, content: string) => string;
  /** 块模板，按块名 */
  templates: Map<string, Template>;
  /** 处理模板展开后的 HTML（双链、图片、过滤） */
  renderTpl: (html: string) => string;
}

function attrs(meta: BlockMeta): string {
  let a = ` class="blk blk-${esc(meta.name)}${meta.cls.map((c) => ' ' + esc(c)).join('')}" data-blk="${esc(meta.name)}"`;
  if (meta.id) a += ` id="${esc(meta.id)}"`;
  if (meta.width) a += ` data-w="${meta.width}" style="--w:${widthNum(meta.width)}"`;
  if (meta.name === '栅格') a += ` data-cols="${meta.cols}"`;
  if (meta.type === 'text') a += ' data-type="text"';
  for (const [k, v] of meta.data) a += ` data-${esc(k)}="${esc(v)}"`;
  return a;
}

function widthNum(w: string): string {
  const [a, b] = w.split('/').map(Number);
  return String(Math.round((a! / b!) * 10000) / 10000);
}

/** 这个块需要和左右的兄弟块并排吗（它在 栅格 里时不需要） */
function inRow(tokens: Token[], idx: number, env: RenderEnv, parentName: string | undefined): boolean {
  return !!(tokens[idx]!.meta as BlockMeta).width && parentName !== '栅格';
}

export function sealedHtml(meta: BlockMeta, pagePath: string): string {
  const w = meta.width ? ` data-w="${meta.width}" style="--w:${widthNum(meta.width)}"` : '';
  return `<div class="blk blk-sealed" data-group="${esc(meta.lock)}"${w}><span class="seal-t">此段缄封</span><span class="seal-d">需要「${esc(meta.lock)}」的钥匙。<a href="/_unlock?to=${encodeURIComponent(pagePath)}">启封</a></span></div>`;
}

export function blocksPlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'jian_block', blockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  const r = md.renderer.rules as Renderer['rules'];
  r.blk_open = (tokens, idx, _o, envAny) => {
    const env = envAny as RenderEnv;
    const meta = tokens[idx]!.meta as BlockMeta;
    const parent = env.blkStack[env.blkStack.length - 1];
    let out = '';
    if (inRow(tokens, idx, env, parent)) {
      const prev = tokens[idx - 1];
      const prevInRow = prev && prev.type === 'blk_close' && prev.level === tokens[idx]!.level && (prev.meta as BlockMeta).width;
      if (!prevInRow) out += '<div class="blk-row">';
    }
    if (meta.lock) {
      out += M.LOCK_OPEN + JSON.stringify({ g: meta.lock, s: sealedHtml(meta, env.pagePath) }) + M.LOCK_MID;
      env.lockStack.push(meta.lock);
    }
    env.blkStack.push(meta.name);
    if (meta.fold) {
      env.foldDepth++;
      out += `<details${attrs(meta)}><summary>${esc(meta.fold)}</summary>`;
    } else {
      out += `<div${attrs(meta)}>`;
    }
    const tpl = env.templates.get(meta.name);
    if (tpl && tpl.before) out += env.renderTpl(fillTemplate(tpl.before, meta));
    return meta.type === 'md' ? out + '\n' : out;
  };
  r.blk_close = (tokens, idx, _o, envAny) => {
    const env = envAny as RenderEnv;
    const meta = tokens[idx]!.meta as BlockMeta;
    env.blkStack.pop();
    const tpl = env.templates.get(meta.name);
    let out = tpl && tpl.after ? env.renderTpl(fillTemplate(tpl.after, meta)) : '';
    out += meta.fold ? '</details>' : '</div>';
    if (meta.fold) env.foldDepth--;
    if (meta.lock) { out += M.LOCK_CLOSE; env.lockStack.pop(); }
    const parent = env.blkStack[env.blkStack.length - 1];
    if (inRow(tokens, idx, env, parent)) {
      const next = tokens[idx + 1];
      const nextInRow = next && next.type === 'blk_open' && next.level === tokens[idx]!.level && (next.meta as BlockMeta).width;
      if (!nextInRow) out += '</div>';
    }
    return out + '\n';
  };
  r.blk_raw = (tokens, idx, _o, envAny) => {
    const env = envAny as RenderEnv;
    const t = tokens[idx]!;
    return env.renderRaw(t.meta as BlockMeta, t.content);
  };
}

/** 收集一篇文章里用到的所有块名（用于「custom.css 里没有样式」的提醒） */
export function collectBlockNames(tokens: Token[]): { name: string; line: number }[] {
  return tokens.filter((t) => t.type === 'blk_open').map((t) => ({ name: (t.meta as BlockMeta).name, line: (t.meta as BlockMeta).line }));
}
