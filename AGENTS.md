# 缄（jian）项目说明

## 项目概况

「缄」是一个用 Markdown 编写、部署到 Cloudflare Workers 的个人文字站。它支持双向链接、图片、可定制主题和按组上锁的页面。站点以 TypeScript 实现，Node.js 直接运行 CLI 源码，不经过单独的构建步骤。

## 目录

- `cli/`：本地命令入口、文章读取与解析、检查和推送逻辑。
- `shared/core.ts`：CLI 与 Worker 共用的数据类型、配置和内容处理工具。
- `worker/src/`：Cloudflare Worker 路由、HTML 视图、D1 API、访问钥匙和图谱。
- `content/`、`assets/`：文章 Markdown 与图片资源；文章可包含 YAML frontmatter。
- `theme/`、`jian.config.json`：主题模板、CSS 和站点配置。
- `public/`：随 Worker 部署的静态资源（包括字体）。
- `test/`：块语法单元测试和本地站点安全验证。
- `wrangler.jsonc`：Worker、D1 及可选 R2 的部署绑定。

## 常用命令

- `npm run check`：检查文章和块语法，不上传。
- `npm run push`：检查并把整站内容推送到配置的站点。
- `npm run dev` 与 `npm run push:local`：启动本地 Worker 并推送本地内容。
- `npm run key -- ...`：创建、列出或撤销访问钥匙。
- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm test`：运行块协议单元测试；`npm run verify`：对运行中的本地站点执行泄漏检查。
- `npm run deploy`：部署 Worker；仅 Worker 代码或部署资源变动通常需要重新部署。

## 修改约定

- 优先遵循 `README.md` 中的内容格式、块协议、部署和主题约定；块模板细节见 `theme/blocks/README.md`。
- 保持中文界面与现有简洁的原生 TypeScript/HTML/CSS 实现风格。没有必要时不要引入框架或新依赖。
- `content/` 中是站点文章和创作内容；修改文章正文、设定或角色资料前，应以用户明确要求的范围为准。
- `content/` 和 `assets/` 是本机写作素材，按 `.gitignore` 排除，不上传到 GitHub。
- 双链、块解析或内容序列化变动时，同时检查 CLI 解析与 Worker 渲染使用的共享数据结构。
- `wrangler.jsonc`、`jian.config.json` 和 `.dev.vars` 可能包含部署环境配置；不要把本机密钥写入受版本控制的文件或输出。

## 安全不变量

- 锁定内容必须在服务端按访客权限过滤，不能仅靠前端隐藏；检查摘要、搜索、目录、图谱、反链、预览、订阅和图片路由是否也遵守权限。
- 带钥匙的响应应保持 `private, no-store`，避免进入共享缓存。
- 口令只通过站点密钥的 HMAC 指纹校验；管理 API 必须校验管理员凭证。
- `html` 块当前允许原样输出；若调整清理策略，兼顾 README 中 `sanitizeHtml` 的说明。
