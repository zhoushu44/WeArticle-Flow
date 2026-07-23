# WeArticle Flow

> AI 驱动的公众号文章创作工作台：从一个想法或公开链接出发，完成内容确认、文章生成、分步配图、预览与 HTML 导出。

## 中文介绍

**WeArticle Flow** 是一个本地运行的公众号内容自动化工具。

你可以输入一句产品想法，或粘贴一篇公开文章 / 产品页链接。系统会提取正文、生成可修改的一句想法，并在后续每一道确认题中关联链接参考内容和已确认答案。完成逐题确认后，AI 会生成标题、原创公众号 HTML，以及与文章内容相关的封面和正文图片。

工具特别适用于将现有内容转化为公众号文章初稿，并保留人工修改空间。文章生成严格以用户确认的信息为基础，缺失信息使用中性表述，不主动编造数据、资质或承诺。

## 核心能力

- 输入一句想法，开始公众号文章创作。
- 粘贴公开网页或微信公众号文章链接，提取文章正文并过滤页面导航等无关内容。
- AI 提炼一句想法，并展示可编辑的链接参考内容。
- 逐题确认产品、受众、痛点、卖点、行动方式、风险和品牌。
- 每道题自动结合链接正文、初始想法及前序答案生成 4 个建议；第一条自动填入自定义输入框，可直接修改。
- 根据逐题确认内容生成 3 个更具钩子感、通俗易懂的标题并选择其一。
- 根据标题和事实动态生成原创、可直接粘贴至公众号编辑器的内联 HTML。
- 右侧预览支持直接编辑文字，失焦后同步回最终 HTML。
- 配图按步骤生成：封面 4 张 → 证据图 1 的 4 张 → 证据图 2 的 4 张 → 证据图 3 的 4 张；证据图按文章上下文生成信息图风格，并包含中文标题和要点标签。
- 选中候选图后立即在右侧预览显示；选择 4 张图片后并发上传腾讯云 COS，并自动替换文章 HTML 中的图片槽位。
- 支持复制 HTML、下载 HTML 与本地会话自动保存；候选图 base64 数据仅保留在当前页面内存中，不写入 localStorage，避免超过浏览器配额。

## 创作流程

```text
一句想法 / 公开链接
→ 提炼想法与可编辑参考内容
→ 7 项逐题确认
→ AI 标题三选一
→ AI 生成原创公众号 HTML
→ 预览区编辑与图片选择
→ 封面 4 选 1
→ 三张正文图分别 4 选 1
→ 上传 COS 并写入 HTML
→ 复制或下载公众号 HTML
```

## 技术栈

- React 18
- TypeScript
- Vite
- Express
- OpenAI 兼容 API
- 腾讯云 COS

## 环境配置

复制 [`.env.example`](.env.example) 为 `.env`，填写以下配置：

```env
OPENAI_API_KEY=你的接口密钥
OPENAI_BASE_URL=https://你的-openai-兼容接口/v1
ARTICLE_MODEL=文章模型名称
IMAGE_MODEL=图片模型名称

COS_SECRET_ID=腾讯云密钥ID
COS_SECRET_KEY=腾讯云密钥
COS_BUCKET=存储桶名称-APPID
COS_REGION=ap-guangzhou
COS_KEY_PREFIX=backups/
```

注意：

- `COS_BUCKET` 需要设置为**公有读**，以便公众号文章可加载图片。
- `.env` 含敏感密钥，不应提交到版本库。
- 链接提取仅接受公开 `http` / `https` 地址；本地地址、内网地址和 `.local` 地址会被拒绝。

## 本地启动

安装依赖：

```bash
npm install
```

启动 API 服务：

```bash
npm run dev:api
```

另开一个终端启动前端：

```bash
npm run dev
```

默认地址：

```text
前端：http://127.0.0.1:5173
API：http://127.0.0.1:8787
```

## Docker 运行

GitHub Actions 会在推送到 `main` 或 `master` 分支后，自动构建并推送以下两个 Docker 镜像标签：

```text
zhoushu1/wearticle-flow:3.0
zhoushu1/wearticle-flow:latest
```

服务器或本机安装 Docker 后，准备好 `.env` 配置文件，直接运行：

```bash
docker pull zhoushu1/wearticle-flow:latest
docker run -d \
  --name wearticle-flow \
  --restart unless-stopped \
  -p 8787:8787 \
  --env-file .env \
  -v "$(pwd)/.env:/app/.env" \
  zhoushu1/wearticle-flow:latest
```

访问地址：

```text
http://你的服务器地址:8787
```

如需固定使用 `3.0` 标签，将镜像名替换为：

```bash
zhoushu1/wearticle-flow:3.0
```

容器内服务监听 `0.0.0.0:8787`。`-v "$(pwd)/.env:/app/.env"` 会把设置页面的修改持久化到宿主机当前目录的 `.env`；请先确保该文件存在。Docker Hub 登录信息仅用于 GitHub Actions 推送，不需要写入 `.env`。

## 验证命令

```bash
npm run check
npm run build
npm run verify:article-integrity
```

## 使用提示

1. 链接内容仅作为背景参考，后续逐题确认的答案优先级更高。
2. 请重点检查价格、性能、资质、领取方式和风险边界等关键信息；缺失信息不会由系统自动补写为具体承诺。
3. 图片生成会受上游模型的并发与速率限制影响，建议按界面的分步流程生成与选择。
4. 候选图刷新页面后不会保留，需要重新生成；已上传到 COS 的 HTTPS 图片链接会保存在本地会话中。
5. 导出前请确认 1 张封面与 3 张正文图片均已上传并写入 HTML。
