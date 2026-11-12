# 缄

基于 Cloudflare Workers 的 Markdown 双链文字站，支持分组加锁、块模板、关系图谱和自定义主题。

- 完整设计见《「缄」项目方案书》，块的写法见其中的「附：块协议 v1」

仓库不包含站点文章和插图。请把自己的内容放在本机的 `content/` 和 `assets/` 目录中；这两个目录默认不会提交到 GitHub。

## 需要准备

- Node.js 22.18 以上（推荐 24）。命令直接运行 `.ts` 文件，不用编译
- 一个 Cloudflare 账号（免费版就够）

## 第一次上线

```bash
# 1. 安装依赖。会顺便复制字体，并在 .dev.vars 里生成本机密钥
npm install

# 2. 登录 Cloudflare（会打开浏览器）
npx wrangler login

# 3. 部署。第一次会自动创建数据库，并把 database_id 写回 wrangler.jsonc
npx wrangler deploy
#    记下最后打印的地址，形如 https://jian.<你的子域>.workers.dev

# 4. 把本机密钥交给站点。打开 .dev.vars，复制 JIAN_SECRET= 后面那串，粘贴进去
npx wrangler secret put JIAN_SECRET

# 5. 把第 3 步的地址填进 jian.config.json 的 "url"

# 6. 推送文章
npm run push

# 7. 给自己发一把主钥匙（打开所有锁）
npm run key -- add 我 --master
```

`.dev.vars` 里的密钥是管理站点的凭证，**不要提交到仓库，也不要发给别人**。`.gitignore` 已经排除了它。

## GitHub 自动部署

可以把仓库连接到 Cloudflare Workers Builds。Cloudflare GitHub App 可以限制为只访问你选择的仓库。文章和图片目录由 `.gitignore` 排除，不会随代码上传。

在 Workers & Pages 中选择连接 GitHub 后，构建设置可用：

- Root directory：仓库根目录
- Build command：留空
- Deploy command：`npm run deploy`
- Production branch：选择你用于发布的分支，例如 `main`

Worker 名称要与 `wrangler.jsonc` 中的 `name`（`jian`）一致。首次构建前，确认 D1 数据库已经创建并在 `wrangler.jsonc` 中填好 `database_id`，同时在 Worker 的 Variables and Secrets 中设置 `JIAN_SECRET`。GitHub 自动部署会发布代码和静态资源；文章及图片内容需在首次部署后从本机运行一次 `npm run push`。之后修改文章时，也要运行 `npm run push`，因为它会把内容同步到 D1。

Cloudflare 构建设置需要部署用的 API Token。连接时检查其权限，并只授权所需资源。

## 日常

```bash
npm run check                                       # 只检查，不上传
npm run push                                        # 检查并推送（整站替换，推完才切换）
npm run key -- add 访客甲 --groups 组甲,组乙 --expires 30d
npm run key -- add 访客甲 --groups 组甲 --pass 自己定的口令
npm run key -- list
npm run key -- revoke 访客甲                          # 立刻失效，已经解锁的人也看不到了
npm run key -- unblock                              # 有人输错太多次被限制时，手动解除
```

改了 Worker 代码（`worker/`）或字体才需要重新 `npx wrangler deploy`；只改文章、主题、配置，`npm run push` 就够了。

## 本地预览

```bash
npm run dev            # 终端一：本地站点，http://localhost:8787
npm run push:local     # 终端二：推到本地
npm run key -- add 我 --master --url http://localhost:8787
```

本地和线上的数据库是分开的，钥匙要各发各的。

## 写作

```
content/            文章，一个 .md 文件就是一页，文件名就是页面名
  index.md          可选：自己写首页。可以用 {{近来}} {{标签}} {{搜索}} 三个占位
assets/             图片（也可以和文章放在一起）
theme/custom.css    你的样式
theme/blocks/       块模板：块名.html，决定块里面的结构
theme/head.html     插到每页 <head> 末尾（字体、统计代码等）
theme/header.html   有这个文件就替换默认页头
theme/footer.html   有这个文件就替换默认页脚
jian.config.json    站点配置
```

页面开头的元信息：

```yaml
---
title: 示例页              # 不写就用文件名
tags: [主题甲, 主题乙]
aliases: [示例别名]          # 写 [[示例别名]] 也能链到这一页
lock: 组甲           # 整页上锁；不写就是公开
date: 2026-11-10         # 不写就用文件修改时间
layout: wide             # narrow（默认）/ wide / full
class: 竖排              # 给这一页加 class；「竖排」是内置的
css: ".doc-body p { text-indent: 2em }"   # 只对这一页生效的样式
cover: 封面.jpg
toc: false               # 不显示右侧大纲
backlinks: false         # 不显示「提及此页」
---
```

正文里：

- `[[页面]]`、`[[页面|显示文字]]`、`[[页面#小标题]]`，没写的页面显示为红链
- `^[脚注内容]`
- `:::名字 参数…` 开一个块，单独一行同样数量的冒号结束。块类型 `html` 原样输出 HTML，`text` 保留空格和换行；`宽=半` 可并排显示，`折叠=标题` 可折叠，`锁=组名` 可上锁。完整规则见块协议
- `:::锁 组名`、`:::剧透 标题`、`::::栅格 列=3` 是内置块；任何块都能加 `锁=`、`折叠=`、`宽=半`

推送前会检查所有块，写错会报出文件和行号，并拦下这次推送。

图片可以放在 `assets/`（站内存储，锁得住），也可以直接写图床的完整地址 `![](https://…)`（原样输出，但锁不住：拿到链接的人都能打开）。

## 站内页面

| 地址 | 内容 |
| --- | --- |
| `/_all` | 目录，按文件夹分组 |
| `/_tags` | 标签 |
| `/_graph` | 图谱：页面之间的双链关系，还没写的页面是红色空心点。`/_graph?focus=页面名` 会高亮那一页 |
| `/_search` | 搜索 |
| `/_unlock` | 启封 |
| `/_feed.xml` | Atom 订阅，最近 20 篇公开文章 |

以上都按访客手里的钥匙过滤，没钥匙的人看不到锁定页出现在任何一处。订阅永远只有公开内容，不看 cookie。

## 自定义

从浅到深：

1. `jian.config.json`：站名、副标题、导航、颜色（浅色和 `dark` 分开）、字号、行距、版心宽度、解锁记住几天、日期格式
2. `theme/custom.css`：所有颜色都是变量（`--bg --ink --muted --rule --rule2 --redlink`），每个块都是 `.blk-块名`，自定义参数在 `data-参数名` 上
3. `theme/*.html`：页头、页脚、`<head>` 片段
4. 页面元信息里的 `layout`、`class`、`css`
5. 自造块：写 `:::角色卡`，再在 custom.css 里给 `.blk-角色卡` 写样式。示例里的角色卡、信笺、设定都是这样做的
6. 块模板：`theme/blocks/信笺.html` 决定 `:::信笺` 里面的结构。用 `{{内容}}` 标出正文的位置，`{{署名}}` 取参数，`{{#署名}}…{{/署名}}` 表示写了才出现，还能写 `[[{{署名}}]]` 这样的双链。详见 `theme/blocks/README.md`

几处默认设计：仿宋没有粗体，所以 `**着重**` 显示为着重号（字下的小点），标题只靠字号和字距区分。不喜欢可以在 custom.css 里改 `.doc-body strong`。

## 安全

- 锁住的内容在服务器端就被拿掉，不会出现在网页源代码、首页、目录、标签、搜索、反链、大纲、悬停预览、摘要里
- 数据库只存口令的 HMAC 指纹；没有站点密钥，拿到数据库也无法离线猜口令
- 每个 IP 每 10 分钟最多输错 10 次
- 收回钥匙立刻生效；同名重新发的钥匙，旧 cookie 不算数
- 锁定内容的响应都是 `private, no-store`，不进共享缓存
- 锁住的图片同样要钥匙才能访问

验证这些规则（需要先 `npm run dev` 和 `npm run push:local`，并在本机准备与 `test/verify.ts` 相符的测试页面；仓库不附带私人文章）：

```bash
npm test          # 块协议解析器的单元测试
npm run verify    # 62 项泄漏检查（含图谱和订阅），会临时发几把钥匙，结束后收回
```

**口令锁防的是访客，不防 Cloudflare。** 数据库里的正文是明文。要连 Cloudflare 也看不到，得等二期的端到端加密页。

`html` 块原样输出，可以写脚本。现在只有你一个作者，这没问题；以后有别人参与写作，把配置里的 `"sanitizeHtml"` 改成 `true`。

## 几点说明

- **图片**默认存在 D1 里，单张不超过 1.9 MB。要放更大的图：在 Cloudflare 控制台开通 R2，取消 `wrangler.jsonc` 里 `r2_buckets` 那行的注释，重新 deploy。开通 R2 需要绑定付款方式，但个人用量在免费额度内
- **边缘缓存**只在绑定自己的域名后生效；`workers.dev` 上 Cloudflare 不提供 Cache API。没有边缘缓存时，公开页面仍然靠浏览器缓存（ETag）和 Worker 内存缓存，每次请求最多查一次数据库
- **字体**用开源的朱雀仿宋（OFL 许可），已经切成 92 片放在 `public/_f/zhuque`，浏览器按页面用到的字下载。系统装了仿宋的设备会优先用系统字体，顺序在 `theme.font` 里改；不想加载网络字体就设 `"webFont": false`
- 换自己的域名：在 Cloudflare 控制台 Workers → jian → 设置 → 域和路由里添加，然后改 `jian.config.json` 的 `url`

## 版本

- 二期（当前）：RSS 订阅、块模板、关系图谱

## 许可

本项目的软件代码采用 [GNU Affero General Public License v3.0（AGPL-3.0）](LICENSE)。`content/` 中的原创文章和 `assets/` 中的原创图片不包含在软件代码许可范围内，未经作者另行许可不得复用。第三方字体及其他素材遵循各自的许可证。

如果你修改本软件并将其作为网络服务提供，AGPL-3.0 第 13 节要求向与服务交互的用户提供对应源代码。公开部署时，请在站点中提供指向该源代码仓库的入口。

## 目录结构

```
cli/        推送命令：读文件、解析 Markdown 与块协议、校验、上传
worker/     Worker：鉴权、按权限拼装页面、管理接口
shared/     两边共用的类型和小工具
public/     静态文件（字体），随 deploy 上传
test/       单元测试与泄漏验证
scripts/    安装后自动运行的准备脚本
```
