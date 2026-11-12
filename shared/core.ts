// 推送命令和 Worker 共用的定义。这里不放任何 Markdown 解析逻辑。

/**
 * 预渲染后的页面正文是一棵树：
 * - 字符串：所有能看到这一层的人都能看到的 HTML
 * - 对象：一个上了锁的块。g = 组名，s = 没有钥匙时显示的缄封提示，c = 块里的内容
 */
export type Node = string | { g: string; s: string; c: Node[] };

/** 正文 HTML 里的占位标记，用 Unicode 私用区字符，正常文字里不会出现 */
export const M = {
  /** 脚注：编号。Worker 按可见顺序重新编号 */
  FN: '',
  /** 指向锁定页的链接后面的标记：组名。访客没有钥匙时换成「缄」字 */
  SEAL: '',
  /** 仅在推送命令内部使用：锁块开始 {json}，结束  */
  LOCK_OPEN: '',
  LOCK_MID: '',
  LOCK_CLOSE: '',
} as const;

export const FN_RE = /(\d+)/g;
export const SEAL_RE = /([^]*)/g;
export const ANY_MARK_RE = /\d+|[^]*/g;

/** 页面数据（存在 pages.doc 里） */
export interface PageDoc {
  tree: Node[];
  notes: string[];
  toc: { l: number; t: string; id: string; req: string[] }[];
  layout: 'narrow' | 'wide' | 'full';
  cls: string;
  css: string;
  cover: string;
  showToc: boolean;
  showBack: boolean;
}

export interface PageRow {
  name: string;
  title: string;
  grp: string; // 整页锁的组名，公开页为空字符串
  tags: string; // JSON 数组
  updated: string; // YYYY-MM-DD
  folder: string;
  excerpt: string;
  doc: string; // JSON PageDoc
}

export interface LinkRow { src: string; dst: string; req: string; ctx: string }
export interface TextRow { page: string; req: string; body: string }
export interface ImgRefRow { hash: string; req: string }

export interface SiteConfig {
  title: string;
  subtitle: string;
  url: string;
  nav: { text: string; href: string }[];
  theme: ThemeConfig;
  webFont: boolean;
  unlockDays: number;
  date: 'cn' | 'iso';
  home: { recent: number };
  markdown: { breaks: boolean };
  blocks: number;
  sanitizeHtml: boolean;
  footer: string;
}

export interface Palette { bg: string; ink: string; muted: string; rule: string; rule2: string; redlink: string }

export interface ThemeConfig extends Palette {
  dark: Palette;
  darkMode: 'auto' | 'light' | 'dark';
  font: string;
  size: number;
  leading: number;
  measure: string;
  titleSpacing: string;
}

export const DEFAULT_CONFIG: SiteConfig = {
  title: '缄',
  subtitle: '',
  url: '',
  nav: [
    { text: '目录', href: '/_all' },
    { text: '标签', href: '/_tags' },
    { text: '图谱', href: '/_graph' },
    { text: '搜索', href: '/_search' },
    { text: '启封', href: '/_unlock' },
  ],
  theme: {
    bg: '#ffffff', ink: '#1d1d1b', muted: '#6b6b66', rule: '#e6e6e2', rule2: '#c6c6c0', redlink: '#9a3324',
    dark: { bg: '#141414', ink: '#e6e4df', muted: '#9a9893', rule: '#2a2a28', rule2: '#4a4a47', redlink: '#d98a76' },
    darkMode: 'auto',
    font: '"FangSong", "STFangsong", "仿宋", "Zhuque Fangsong (technical preview)", serif',
    size: 18,
    leading: 2,
    measure: '36em',
    titleSpacing: '.12em',
  },
  webFont: true,
  unlockDays: 7,
  date: 'cn',
  home: { recent: 10 },
  markdown: { breaks: true },
  blocks: 1,
  sanitizeHtml: false,
  footer: '',
};

/** 深合并：用户配置覆盖默认值 */
export function mergeConfig(user: unknown): SiteConfig {
  const merge = (a: any, b: any): any => {
    if (b === undefined || b === null) return a;
    if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object') return b;
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
    return out;
  };
  return merge(DEFAULT_CONFIG, user);
}

/** req 是一组组名；访客必须持有其中每一个组 */
export function parseReq(s: string): string[] {
  if (!s || s === '[]') return [];
  try { return JSON.parse(s); } catch { return []; }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function cnNum(n: number): string {
  if (n <= 10) return CN_NUM[n]!;
  if (n < 20) return '十' + CN_NUM[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return CN_NUM[t] + '十' + (o ? CN_NUM[o] : '');
}

/** 2026-11-10 → 十一月十日（或原样） */
export function fmtDate(iso: string, style: 'cn' | 'iso', withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  if (style === 'iso') return withYear ? `${m[1]}-${m[2]}-${m[3]}` : `${m[2]}-${m[3]}`;
  const y = [...m[1]!].map((d) => CN_NUM[+d]).join('');
  return (withYear ? y + '年' : '') + cnNum(+m[2]!) + '月' + cnNum(+m[3]!) + '日';
}

/** 11.10 这样的短日期，用于列表 */
export function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}.${m[2]}` : iso;
}

/** 页面名 → URL 路径 */
export function pagePath(name: string): string {
  return '/' + encodeURIComponent(name);
}

/** 把 HTML 变成纯文字（用于摘要和搜索） */
export function plain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|blockquote|details|summary)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉 <details>…</details>（支持嵌套），摘要里不放剧透 */
export function stripDetails(html: string): string {
  let out = '', depth = 0, i = 0;
  const re = /<details\b[^>]*>|<\/details>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (depth === 0) out += html.slice(i, m.index);
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth < 0) depth = 0;
    i = m.index + m[0].length;
  }
  if (depth === 0) out += html.slice(i);
  return out;
}
