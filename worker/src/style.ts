// 默认主题「素笺」。颜色、字体、版心都是 CSS 变量，由 jian.config.json 的 theme 生成。
// theme/custom.css 接在最后，可以覆盖这里的任何东西。

import type { Palette, SiteConfig } from '../../shared/core.ts';

function palette(p: Palette): string {
  return `--bg:${p.bg};--ink:${p.ink};--muted:${p.muted};--rule:${p.rule};--rule2:${p.rule2};--redlink:${p.redlink};`;
}

export function themeCss(cfg: SiteConfig): string {
  const t = cfg.theme;
  const base = `--font:${t.font};--size:${t.size}px;--leading:${t.leading};--measure:${t.measure};--title-spacing:${t.titleSpacing};`;
  let css = `:root{${base}${palette(t)}color-scheme:light}`;
  const dark = `${palette(t.dark)}color-scheme:dark`;
  if (t.darkMode === 'dark') css = `:root{${base}${dark}}`;
  else if (t.darkMode === 'auto') css += `@media (prefers-color-scheme:dark){:root{${dark}}}`;
  return css;
}

export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:var(--size);line-height:var(--leading);-webkit-font-smoothing:antialiased;font-kerning:normal}
a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.32em;text-decoration-color:var(--rule2)}
a:hover{text-decoration-color:var(--ink)}
a.red{color:var(--redlink);text-decoration-style:dotted;text-decoration-color:var(--redlink)}
.seal{font-size:.6em;color:var(--muted);margin-left:.15em;vertical-align:.45em;line-height:0;text-decoration:none}
::selection{background:var(--rule)}
:focus-visible{outline:1px solid var(--ink);outline-offset:3px}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px}

.bar{max-width:1040px;margin:0 auto;padding:40px 32px 0;display:flex;flex-wrap:wrap;gap:16px 40px;justify-content:space-between;align-items:baseline}
.site{font-size:22px;letter-spacing:.4em;text-decoration:none;margin-right:-.4em}
.nav{display:flex;flex-wrap:wrap;gap:8px 28px;font-size:15px;letter-spacing:.1em}
.nav a{color:var(--muted);text-decoration:none}
.nav a:hover,.nav a[aria-current]{color:var(--ink)}
.foot{max-width:1040px;margin:0 auto;padding:120px 32px 48px;font-size:13px;color:var(--muted);letter-spacing:.1em;display:flex;flex-wrap:wrap;gap:8px 32px;justify-content:space-between}

.wrap{max-width:1040px;margin:0 auto;padding:96px 32px 0;display:flex;flex-wrap:wrap;gap:48px 80px;align-items:flex-start}
.col{flex:999 1 560px;max-width:var(--measure);min-width:0}
.l-wide .col{max-width:56em}
.l-full .col{max-width:none}
.l-full.wrap{max-width:none}
.toc{flex:1 1 160px;position:sticky;top:48px;font-size:14px;color:var(--muted);padding-top:132px;line-height:2.2}
.toc p{margin:0 0 8px;letter-spacing:.2em;font-size:13px}
.toc a{text-decoration:none;color:var(--muted);display:block;padding-left:14px;border-left:1px solid var(--rule)}
.toc a.l3{padding-left:28px;font-size:13px}
.toc a.on,.toc a:hover{color:var(--ink);border-left-color:var(--ink)}
@media (max-width:960px){.toc{display:none}}

h1,h2,h3,h4,h5,h6{font-weight:400;line-height:1.5}
.doc-head h1,.page-title{font-size:40px;letter-spacing:var(--title-spacing);margin:0;line-height:1.4}
.meta{margin-top:16px;font-size:14px;color:var(--muted);letter-spacing:.05em}
.meta a{color:var(--muted);text-decoration:none}
.meta a:hover{color:var(--ink)}
.cover{display:block;width:100%;height:auto;margin:0 0 48px}
.doc-body{margin-top:56px}
.doc-body>:first-child{margin-top:0}
.doc-body p{margin:0 0 1.2em}
.doc-body h2{font-size:1.34em;letter-spacing:.1em;margin:2.6em 0 .8em}
.doc-body h3{font-size:1.12em;letter-spacing:.08em;margin:2em 0 .6em}
.doc-body h4,.doc-body h5,.doc-body h6{font-size:1em;letter-spacing:.06em;margin:1.6em 0 .4em;color:var(--muted)}
.doc-body ul,.doc-body ol{margin:0 0 1.2em;padding-left:1.6em}
.doc-body li{margin:.2em 0}
.doc-body blockquote{margin:1.6em 0;padding:0 0 0 22px;border-left:1px solid var(--rule2);color:var(--muted)}
.doc-body hr{border:0;margin:3em auto;text-align:center;color:var(--muted);letter-spacing:1em}
.doc-body hr::before{content:"◦ ◦ ◦"}
.doc-body img{max-width:100%;height:auto}
.doc-body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.84em;padding:0 .2em;background:var(--rule)}
.doc-body pre{font-size:14px;line-height:1.75;overflow-x:auto;padding:16px 0 16px 18px;border-left:1px solid var(--rule2);margin:1.6em 0}
.doc-body pre code{background:none;padding:0;font-size:1em}
.doc-body table{border-collapse:collapse;margin:1.6em 0;font-size:.92em;display:block;overflow-x:auto;max-width:100%}
.doc-body th,.doc-body td{border-bottom:1px solid var(--rule);padding:8px 20px 8px 0;text-align:left;vertical-align:top}
.doc-body th{font-weight:400;color:var(--muted);border-bottom-color:var(--rule2)}
.doc-body mark{background:none;border-bottom:1px solid var(--redlink);color:inherit}
.doc-body strong{font-weight:inherit;text-emphasis:filled dot var(--muted);-webkit-text-emphasis:filled dot var(--muted);text-emphasis-position:under right;-webkit-text-emphasis-position:under right}
.doc-body em{font-style:normal;border-bottom:1px solid var(--rule2)}

.fnref{font-size:.62em;line-height:0;margin:0 .12em}
.fnref a{text-decoration:none;color:var(--muted)}
.fn-inline{display:none}
.footnotes{margin-top:72px;padding-top:24px;border-top:1px solid var(--rule);font-size:14px;line-height:1.9;color:var(--muted)}
.footnotes ol{margin:0;padding-left:1.4em}
.footnotes li{margin:0 0 .6em}
.footnotes .back-ref{text-decoration:none;margin-left:.4em}

.blk{margin:2em 0}
.blk>:first-child{margin-top:0}.blk>:last-child{margin-bottom:0}
.blk[data-type=text]{white-space:pre-wrap}
.blk-row{display:flex;flex-wrap:wrap;gap:32px;margin:2em 0}
.blk-row>.blk{margin:0;flex:1 1 calc(var(--w,1) * 100% - 32px);min-width:min(100%,14em)}
.blk-栅格{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:32px}
.blk-栅格>.blk,.blk-栅格>.blk-row{margin:0}
.blk-栅格[data-cols="1"]{--cols:1}.blk-栅格[data-cols="2"]{--cols:2}.blk-栅格[data-cols="3"]{--cols:3}
.blk-栅格[data-cols="4"]{--cols:4}.blk-栅格[data-cols="5"]{--cols:5}.blk-栅格[data-cols="6"]{--cols:6}
@media (max-width:720px){.blk-栅格{--cols:1!important;grid-template-columns:minmax(0,1fr)}.blk-row>.blk{flex-basis:100%}}
details.blk{border-left:1px solid var(--rule2);padding:2px 0 2px 22px}
details.blk>summary{cursor:pointer;color:var(--muted);font-size:.84em;letter-spacing:.08em;list-style:none}
details.blk>summary::-webkit-details-marker{display:none}
details.blk>summary::after{content:"　展开"}
details.blk[open]>summary{margin-bottom:12px}
details.blk[open]>summary::after{content:"　收起"}
.blk-锁{border-left:1px solid var(--rule2);padding:2px 0 2px 22px}
.blk-sealed{border-left:1px solid var(--rule2);padding:2px 0 2px 22px;color:var(--muted);font-size:.84em;letter-spacing:.06em}
.blk-sealed .seal-t{display:block}
.blk-sealed .seal-d{display:block;margin-top:4px;letter-spacing:0}

.back{margin-top:88px;border-top:1px solid var(--rule);padding-top:32px}
.cap{font-size:13px;letter-spacing:.24em;color:var(--muted);margin:0 0 20px;font-weight:400}
.back .cap{display:flex;justify-content:space-between;gap:16px}
.cap .to-graph{letter-spacing:.1em;color:var(--muted);text-decoration:none}
.cap .to-graph:hover{color:var(--ink)}
.back ul,.list{list-style:none;margin:0;padding:0}
.back li{margin:0 0 18px}
.back li a{font-size:17px}
.back li div{font-size:14px;color:var(--muted);margin-top:2px}

.peek{position:absolute;z-index:10;width:300px;padding:16px 18px;background:var(--bg);border:1px solid var(--rule2);font-size:14px;line-height:1.8;color:var(--muted);pointer-events:none;animation:peek .16s ease-out}
.peek b{display:block;font-weight:400;font-size:16px;color:var(--ink);margin-bottom:4px;letter-spacing:.08em}
@keyframes peek{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.peek{animation:none}}

.hero{font-size:56px;letter-spacing:.5em;margin:0 -.5em 0 0;font-weight:400;line-height:1.3}
.lede{margin-top:28px;font-size:var(--size);line-height:2}
.sec{margin-top:88px}
.list li{display:flex;gap:24px;align-items:baseline;padding:14px 0;border-bottom:1px solid var(--rule)}
.list .dt{font-size:14px;color:var(--muted);width:56px;flex:none;font-variant-numeric:tabular-nums}
.list .t{flex:1 1 auto;min-width:0}
.list .t a{font-size:18px}
.list .x{display:block;font-size:14px;color:var(--muted);margin-top:2px;line-height:1.8}
.list .tg{font-size:14px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:12px 32px;font-size:17px}
.tags span{color:var(--muted);font-size:13px;margin-left:6px}
.srch{display:flex;gap:16px;align-items:baseline;margin-top:56px;border-bottom:1px solid var(--rule2);padding-bottom:8px}
.srch label{font-size:14px;color:var(--muted);letter-spacing:.2em;flex:none}
.srch input,.key input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:18px;color:var(--ink);outline:none;padding:4px 0}
.srch button{font:inherit;font-size:14px;color:var(--muted);background:none;border:0;cursor:pointer;letter-spacing:.2em;padding:8px 0;min-height:44px}
.hit mark{background:none;color:var(--ink);border-bottom:1px solid var(--redlink)}
.folder{margin-top:64px}.folder:first-child{margin-top:0}

.narrow{max-width:460px;margin:0 auto;padding:120px 32px 0}
.key{margin-top:56px}
.key label{display:block;font-size:14px;color:var(--muted);letter-spacing:.2em}
.key .row{display:flex;border-bottom:1px solid var(--rule2);margin-top:8px}
.btn{margin-top:36px;display:inline-block;font:inherit;font-size:16px;letter-spacing:.4em;padding:10px 26px 10px 32px;min-height:44px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;text-decoration:none}
.btn:hover{background:var(--ink);color:var(--bg)}
.btn.quiet{border-color:var(--rule2);color:var(--muted)}
.note{margin-top:28px;font-size:14px;color:var(--muted);line-height:1.9}
.err{margin-top:20px;font-size:14px;color:var(--redlink)}
.held{list-style:none;padding:0;margin:24px 0 0;font-size:15px}
.held li{padding:10px 0;border-bottom:1px solid var(--rule);display:flex;justify-content:space-between;gap:16px}
.held span{color:var(--muted);font-size:13px}

/* 内置页面样式：class: 竖排 */
.竖排 .wrap{display:block}
.竖排 .col{max-width:none}
.竖排 .doc{width:100%;writing-mode:vertical-rl;height:min(72vh,640px);overflow-x:auto;overflow-y:hidden;line-height:2.3;letter-spacing:.1em;scrollbar-width:thin}
.竖排 .doc-head h1{margin:0 0 0 12px;letter-spacing:.3em}
.竖排 .meta{margin:0 0 0 40px}
.竖排 .doc-body{margin:0}
.竖排 .doc-body p{margin:0 0 0 .6em;text-indent:2em}
.竖排 .footnotes{margin:0 72px 0 0;padding:0 24px 0 0;border-top:0;border-right:1px solid var(--rule)}
.竖排 .toc{display:none}

@media (max-width:640px){
  .bar{padding:28px 20px 0}
  .wrap,.narrow{padding:64px 20px 0}
  .foot{padding:80px 20px 40px}
  .doc-head h1,.page-title{font-size:32px}
  .hero{font-size:44px}
  .doc-body{margin-top:40px}
}
@media print{.bar,.nav,.toc,.back,.foot,.peek{display:none}.wrap{padding-top:0}.fn-inline{display:none}}
`;
