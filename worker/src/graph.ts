// 关系图谱：/_graph
//
// 节点和边在服务端按访客权限过滤好，再嵌进页面。客户端只负责布局和交互，拿不到它不该看的东西：
// - 节点：访客能看的页面，加上「还没写」的红链目标
// - 边：来源页能看、而且双链所在的锁块也能看，才算数
// - 指向锁定页的边：访客看不了那一页就整条丢掉，不会变成红链节点

import { esc, pagePath } from '../../shared/core.ts';

export interface GraphNode { n: string; t: string; ghost?: 1 }
export interface GraphData { nodes: GraphNode[]; edges: [string, string][] }

export const GRAPH_CSS = `
.gcol{flex-basis:100%;max-width:none}
.gwrap{position:relative;margin-top:48px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
#graph{display:block;width:100%;height:min(72vh,720px);touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
#graph.grabbing{cursor:grabbing}
#graph .ge{pointer-events:none;stroke:var(--rule2);stroke-width:1;vector-effect:non-scaling-stroke;transition:opacity .15s}
#graph .gn{transition:opacity .15s;outline:none;text-decoration:none}
#graph .gn circle{fill:var(--ink)}
#graph .gn.ghost circle{fill:var(--bg);stroke:var(--redlink);stroke-width:1;stroke-dasharray:2 2;vector-effect:non-scaling-stroke}
#graph .gn text{font-family:var(--font);fill:var(--muted);paint-order:stroke;stroke:var(--bg);stroke-linejoin:round;pointer-events:none;transition:opacity .15s}
#graph .gn.ghost text{fill:var(--redlink)}
#graph .gn.lh text{opacity:0}
#graph.near .gn.lh text{opacity:1}
#graph.hov .gn:not(.on){opacity:.16}
#graph.hov .ge:not(.on){opacity:.08}
#graph .gn.on text{opacity:1;fill:var(--ink)}
#graph .gn.on.ghost text{fill:var(--redlink)}
#graph .gn:focus-visible circle{stroke:var(--ink);stroke-width:2;vector-effect:non-scaling-stroke}
#graph .gn.focus circle{stroke:var(--redlink);stroke-width:2;vector-effect:non-scaling-stroke}
.gctl{position:absolute;right:0;top:12px;display:flex;gap:6px}
.gctl button{font:inherit;font-size:15px;min-width:44px;height:44px;padding:0 10px;border:1px solid var(--rule2);background:var(--bg);color:var(--muted);cursor:pointer}
.gctl button:hover{color:var(--ink);border-color:var(--ink)}
.glegend{display:flex;flex-wrap:wrap;gap:8px 28px;font-size:13px;color:var(--muted);margin-top:16px;letter-spacing:.05em}
.glegend i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ink);margin-right:8px;vertical-align:.1em}
.glegend i.g{background:none;border:1px dashed var(--redlink)}
.gtext{margin-top:48px}
.gtext .n{color:var(--muted);font-size:13px;margin-left:8px}
`;

const SCRIPT = `(()=>{const el=document.getElementById('gd'),svg=document.getElementById('graph');if(!el||!svg)return;
const D=JSON.parse(el.textContent),N=D.nodes;if(!N.length)return;const NS='http://www.w3.org/2000/svg';
const mk=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e};
const id=new Map(N.map((n,i)=>[n.n,i]));const hash=s=>{let x=2166136261;for(const c of s){x^=c.codePointAt(0);x=Math.imul(x,16777619)}return x>>>0};
const L=[];const seen=new Set();for(const[a,b]of D.edges){const i=id.get(a),j=id.get(b);if(i==null||j==null||i===j)continue;const k=i<j?i+','+j:j+','+i;if(seen.has(k))continue;seen.add(k);L.push([i,j])}
N.forEach(n=>{n.nb=new Set()});L.forEach(([a,b])=>{N[a].nb.add(b);N[b].nb.add(a)});
const n=N.length,R=Math.sqrt(n)*46;N.forEach(p=>{const a=hash(p.n)%62832/1e4,r=R*(.25+(hash(p.n+'~')%1000)/1250);p.x=Math.cos(a)*r;p.y=Math.sin(a)*r;p.vx=p.vy=0});
const rep=20000,len=140;for(let t=0,T=n>400?180:300;t<T;t++){const al=1-t/T;
for(let i=0;i<n;i++){const p=N[i];for(let j=i+1;j<n;j++){const q=N[j];let dx=p.x-q.x,dy=p.y-q.y,d2=dx*dx+dy*dy;if(d2>360000)continue;if(d2<1){dx=(i%7)-3;dy=(j%5)-2;d2=dx*dx+dy*dy+1}const d=Math.sqrt(d2),f=(rep/d2+(d<80?(80-d)*.6:0))*al;p.vx+=dx*f/d;p.vy+=dy*f/d;q.vx-=dx*f/d;q.vy-=dy*f/d}}
for(const[a,b]of L){const p=N[a],q=N[b],dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy)||1,f=(d-len)/d*.06;p.vx+=dx*f;p.vy+=dy*f;q.vx-=dx*f;q.vy-=dy*f}
for(const p of N){p.vx-=p.x*.008*(p.nb.size?1:1.6);p.vy-=p.y*.008*(p.nb.size?1:1.6);const v=Math.hypot(p.vx,p.vy);if(v>24){p.vx*=24/v;p.vy*=24/v}p.x+=p.vx;p.y+=p.vy;p.vx*=.55;p.vy*=.55}}
const eg=mk('g',{}),ng=mk('g',{});svg.append(eg,ng);const showAll=n<=60;
const lines=L.map(([a,b])=>{const l=mk('line',{class:'ge'});l.a=a;l.b=b;eg.append(l);return l});
const G=N.map((p,i)=>{const a=mk('a',{href:'/'+encodeURIComponent(p.n),class:'gn'+(p.ghost?' ghost':'')+(showAll||p.nb.size>=3?'':' lh'),'aria-label':p.t+(p.ghost?'（还没写）':'')});
const r=3.6+Math.sqrt(p.nb.size)*1.9;p.r=r;const c=mk('circle',{r});const tx=mk('text',{'text-anchor':'middle'});tx.textContent=p.t;a.append(c,tx);a.i=i;ng.append(a);return a});
let vb;const fit=(pad=40)=>{let x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;for(const p of N){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y)}
const w=Math.max(x1-x0,200)+pad*2,h=Math.max(y1-y0,160)+pad*2,cw=svg.clientWidth||1000,ch=svg.clientHeight||700,s=Math.max(w/cw,h/ch,.55);vb={x:(x0+x1)/2-cw*s/2,y:(y0+y1)/2-ch*s/2,w:cw*s,h:ch*s};draw()};
const draw=()=>{svg.setAttribute('viewBox',vb.x+' '+vb.y+' '+vb.w+' '+vb.h);const k=vb.w/(svg.clientWidth||1000);svg.classList.toggle('near',k<.7);
for(const l of lines){const p=N[l.a],q=N[l.b];l.setAttribute('x1',p.x);l.setAttribute('y1',p.y);l.setAttribute('x2',q.x);l.setAttribute('y2',q.y)}
for(const a of G){const p=N[a.i],c=a.firstChild,t=a.lastChild;c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);c.setAttribute('r',p.r*k);t.setAttribute('x',p.x);t.setAttribute('y',p.y+(p.r+16)*k);t.setAttribute('font-size',13*k);t.setAttribute('stroke-width',3*k)}};
const pt=e=>{const r=svg.getBoundingClientRect();return{x:vb.x+(e.clientX-r.left)/r.width*vb.w,y:vb.y+(e.clientY-r.top)/r.height*vb.h}};
const zoom=(f,c)=>{c=c||{x:vb.x+vb.w/2,y:vb.y+vb.h/2};const w=Math.min(Math.max(vb.w*f,120),R*40);f=w/vb.w;vb={x:c.x-(c.x-vb.x)*f,y:c.y-(c.y-vb.y)*f,w,h:vb.h*f};draw()};
const hl=i=>{svg.classList.toggle('hov',i!=null);for(const a of G)a.classList.toggle('on',i!=null&&(a.i===i||N[i].nb.has(a.i)));for(const l of lines)l.classList.toggle('on',i!=null&&(l.a===i||l.b===i))};
let drag=null,moved=false;svg.addEventListener('pointerdown',e=>{const a=e.target.closest('.gn');const p=pt(e);drag={a,p,x:e.clientX,y:e.clientY,vb:{...vb}};moved=false;svg.setPointerCapture(e.pointerId);svg.classList.add('grabbing')});
svg.addEventListener('pointermove',e=>{if(!drag){const a=e.target.closest&&e.target.closest('.gn');hl(a?a.i:null);return}
if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4)moved=true;if(!moved)return;
if(drag.a){const p=pt(e),q=N[drag.a.i];q.x=p.x;q.y=p.y;draw()}else{const r=svg.getBoundingClientRect(),s=drag.vb.w/r.width;vb={...drag.vb,x:drag.vb.x-(e.clientX-drag.x)*s,y:drag.vb.y-(e.clientY-drag.y)*s};draw()}});
const up=()=>{drag=null;svg.classList.remove('grabbing')};svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',up);svg.addEventListener('pointerleave',()=>{if(!drag)hl(null)});
svg.addEventListener('click',e=>{if(moved){e.preventDefault();moved=false}},true);
svg.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.0015),pt(e))},{passive:false});
ng.addEventListener('focusin',e=>{const a=e.target.closest('.gn');a&&hl(a.i)});ng.addEventListener('focusout',()=>hl(null));
document.getElementById('gin').onclick=()=>zoom(.7);document.getElementById('gout').onclick=()=>zoom(1/.7);document.getElementById('gfit').onclick=()=>fit();
addEventListener('resize',()=>fit());fit();
const f=new URLSearchParams(location.search).get('focus');if(f&&id.has(f)){const i=id.get(f),p=N[i];G[i].classList.add('focus');hl(i);const w=Math.min(vb.w,(svg.clientWidth||1000)*.8);vb={x:p.x-w/2,y:p.y-w*vb.h/vb.w/2,w,h:w*vb.h/vb.w};draw()}})();`;

export function graphView(data: GraphData, degree: Map<string, number>): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const list = [...data.nodes]
    .sort((a, b) => (degree.get(b.n) ?? 0) - (degree.get(a.n) ?? 0) || a.t.localeCompare(b.t, 'zh'))
    .map((n) => `<li><span class="t"><a href="${pagePath(n.n)}"${n.ghost ? ' class="red"' : ''}>${esc(n.t)}</a><span class="n">${degree.get(n.n) ?? 0} 条链接${n.ghost ? ' · 还没写' : ''}</span></span></li>`)
    .join('');
  const empty = !data.nodes.length;
  return `<main id="main" class="wrap"><div class="col gcol">
<h1 class="page-title">图谱</h1>
<p class="meta">${data.nodes.filter((x) => !x.ghost).length} 篇，${data.edges.length} 条双链。拖动平移，滚轮缩放，点一下打开。</p>
${empty ? '<p class="lede">还没有可以画的页面。</p>' : `<div class="gwrap">
<svg id="graph" role="img" aria-label="页面之间的双链关系图"></svg>
<div class="gctl"><button id="gin" type="button" aria-label="放大">＋</button><button id="gout" type="button" aria-label="缩小">－</button><button id="gfit" type="button">复位</button></div>
</div>
<div class="glegend"><span><i></i>已写的页面</span><span><i class="g"></i>还没写</span><span>点越大，链接越多</span></div>
<details class="blk gtext"><summary>文字版</summary><ul class="list">${list}</ul></details>
<script type="application/json" id="gd">${json}</script>
<script>${SCRIPT}</script>`}
</div></main>`;
}
