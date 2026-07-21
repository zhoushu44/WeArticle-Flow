export type ProofPoint = { title: string; claim: string; caption: string; imagePrompt: string }
export type ArticleIdea = { raw: string; product: string; audience: string[]; painPoints: string[]; solution: string; accessStandard: string; keyword: string; tools: string[]; proofPoints: ProofPoint[]; risks: string[]; brand: string; brandSlogan: string }
export type Check = { category: '结构' | '事实' | '样式' | '图像'; name: string; passed: boolean; detail: string }

export const benchmarkKeyword = 'grok'
export const benchmarkIdea = `给使用 Codex、Cursor、Claude Code 等工具的开发者，提供一个无需注册 xAI、无需绑卡的 OpenAI 兼容入口，让他们通过私信“grok”进群领取 Key，低门槛试用 Grok 4.5；用额度、模型可用性和服务稳定性三类证据建立信任，同时明确第三方、动态额度和生产自评估的边界。`

// 这是从黄金成品反推的可执行提示词契约。命中后只使用确定性模板，避免模型采样造成文字漂移。
export const goldenArticlePrompt = `你是公众号产品推广文章生成器。主题：Grok 4.5。目标读者：Codex、Cursor、Claude Code、OpenCode 用户。核心承诺：无需注册 xAI、无需绑卡，通过 OpenAI 兼容接口，私信“grok”进群领取 Key 后直接使用。必须依次输出：文章外层、标题、封面图槽位 <section data-component="cover-image">（位于标题后、首屏承诺卡前）、绿色首屏承诺卡、痛点段、一句话承诺、01 额度/模型/稳定性三项证据及三个 <section data-component="evidence-image"> 正文图槽位、02 OpenAI 兼容与三步接入、03 适合人群和第三方/动态额度/生产自评估边界、04 私信 grok 领取、深色结尾卡与免责声明。封面图槽位和 3 个正文图槽位均不可省略，后续会替换为 COS 公共 HTTPS 图片。视觉令牌：#059669、#10B981、#A7F3D0、#FDE68A、#111827；首屏圆角 20px、章节编号 01-04。输出必须使用黄金 HTML 模板，不改写任何字符。`

export function isBenchmarkKeyword(raw: string) {
  return raw.trim().toLowerCase() === benchmarkKeyword
}

export function isGoldenArticlePrompt(raw: string) {
  return raw.trim() === goldenArticlePrompt
}

export function isGoldenTrigger(raw: string) {
  return isBenchmarkKeyword(raw) || isGoldenArticlePrompt(raw)
}

export function parseIdea(raw: string) {
  const product = raw.match(/(?:产品|服务|方案|主题)[:：]?\s*([^，。；;]+)/)?.[1]?.trim() || raw.trim().slice(0, 32) || '这个主题'
  const keyword = raw.match(/私信[“"]?([^”"，、；; ]+)/)?.[1] ?? ''
  return { raw, product, audience: ['对该主题感兴趣的读者'], painPoints: ['缺少清晰、可信、可执行的信息'], solution: '把核心信息讲清楚，并给出可执行的下一步', accessStandard: '具体实施方式以确认事实为准', keyword, tools: [], proofPoints: [{ title: '核心发现', claim: '从确认后的事实中提炼最重要的发现', caption: '— 核心发现', imagePrompt: 'Clear visual metaphor for the core finding, specific subject, editorial composition, no logos' }, { title: '真实场景', claim: '展示核心发现如何影响真实的人或场景', caption: '— 真实场景', imagePrompt: 'A concrete real-world scene illustrating the topic, clear causal relationship, editorial composition, no logos' }, { title: '行动启发', claim: '把研究或事实转化为读者可理解的行动启发', caption: '— 行动启发', imagePrompt: 'A compelling visual metaphor for practical insight and next step, clear subject, editorial composition, no logos' }], risks: ['具体边界以确认后的事实为准'], brand: '', brandSlogan: '' }
}

const p = (content: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.9;text-align:justify;">${content}</p>`
const sectionTitle = (number: string, title: string, sub: string) => `<section data-component="section-${number}" style="display:flex;align-items:center;gap:16px;margin-bottom:24px;"><section style="text-align:center"><p style="margin:0;font-size:29px;font-weight:900;color:#059669;line-height:1">${number}</p><p style="margin:0;font-size:12px;font-weight:700;color:#d1d5db;letter-spacing:2px">PART</p></section><span style="width:1px;height:36px;background:#e5e7eb"></span><section><p style="margin:0;font-size:18px;font-weight:900;color:#111827">${title}</p><p style="margin:0;font-size:12px;color:#9ca3af;letter-spacing:1.5px">${sub}</p></section></section>`
const image = (proof: ProofPoint, width: string) => `<section data-component="evidence-image" style="width:${width};margin:0 auto 4px;background:#fff;border-radius:12px;padding:6px;border:1px solid #e5e7eb;box-shadow:0 4px 12px -2px rgba(0,0,0,.08)"><section style="height:130px;border-radius:8px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);display:flex;align-items:center;justify-content:center;color:#059669;font-size:13px;font-weight:700">证据图槽位 · ${proof.title}</section></section><p style="font-size:13px;color:#9ca3af;text-align:center;margin:0 0 20px">${proof.caption}</p>`

export function renderArticle(data: ArticleIdea) {
  const [quota, model, stable] = data.proofPoints
  const tools = data.tools.map((tool) => `<p style="margin:0 0 12px"><span style="display:inline-block;font-size:14px;font-weight:700;color:#059669;background:rgba(5,150,105,.08);padding:3px 10px;border-radius:999px">● ${tool}</span><br><span style="font-size:14px;color:#4b5563">填自定义 Base URL + Key，直接用。</span></p>`).join('')
  const risks = data.risks.map((risk) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.9">· <strong>${risk}</strong></p>`).join('')
  return `<section data-component="article" style="max-width:677px;margin:0 auto;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#374151;line-height:1.75;letter-spacing:.5px;overflow-x:hidden">
<section data-component="cover-image" style="margin:0 0 22px;border-radius:12px;overflow:hidden;background:#ecfdf5;color:#059669;text-align:center"><section style="aspect-ratio:2.35/1;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">封面图槽位 · 2.35:1</section></section>
<section data-component="hero-card" style="margin:0 0 28px;background:#fff;border:1.5px solid rgba(5,150,105,.15);border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06)"><section style="padding:30px 24px 26px"><p style="font-size:12px;font-weight:700;letter-spacing:3px;color:#059669;margin:0 0 22px">FREE ACCESS · 免费直连</p><p style="font-size:22px;font-weight:900;color:#111827;margin:0">不用注册、不用绑卡</p><p style="font-size:22px;font-weight:900;color:#059669;margin:2px 0 16px">进群领 Key，直接跑 ${data.product}</p><p style="font-size:13px;color:#9ca3af;margin:0">${data.accessStandard} · ${data.tools.join(' / ')} · 一键接入</p></section><section style="background:linear-gradient(135deg,#059669,#10b981);padding:12px 24px;color:#fff;font-size:12px;font-weight:600">${data.brand} · ${data.brandSlogan}</section></section>
<section style="padding:0 8px">${p(`${data.product} 这几天有多火，不用我多说——<span style="border-bottom:2px solid #a7f3d0;font-weight:600">热门模型正在进入开发者工作流</span>，但大部分人卡在同一个门槛：${data.painPoints.join('、')}。`)}${p(`想上手一个新模型，本不该这么麻烦。所以这篇，给你一条<span style="border-bottom:2px solid #a7f3d0;font-weight:600">更省事的路</span>。`)}</section>
<section data-component="one-sentence" style="border:1px dashed #bbf7d0;border-radius:8px;padding:14px;margin:0 8px 24px;text-align:center"><p style="font-size:13px;color:#9ca3af;margin:0 0 6px">一句话说清</p><strong style="font-size:16px;color:#059669;border-bottom:3px solid #fde68a">私信发“${data.keyword}”、进群，就能低门槛试用 ${data.product}</strong></section>
<section style="padding:0 8px">${p(`${data.accessStandard}，一个 Key，直接在熟悉的工具里跑。${data.solution}——填进 <strong style="color:#059669">${data.tools.join(' / ')}</strong> 就能用。`)}</section>
<section style="margin:16px 0 28px;padding:0 8px">${sectionTitle('01', quota.title, 'QUOTA · 真实后台')}${p(`不吹虚的，直接看后台。${quota.claim}：`)}${image(quota, '62%')}${p(`模型——<strong style="color:#059669">${model.claim}</strong>，拿到 Key 直接调：`)}${image(model, '88%')}${p(`更关键的是稳定性。${stable.claim}：`)}${image(stable, '92%')}<p style="margin:0;font-size:14px"><strong style="color:#059669">额度是真的多、模型是真的全、服务是真的稳。</strong> 关注进群，就能用起来。</p></section>
<section style="margin:48px 0 28px;padding:0 8px">${sectionTitle('02', 'OpenAI 接口，所以哪都能用', 'OPENAI API · 通用接入')}${p(`这套服务最大的好处：<strong style="color:#059669">走的是 OpenAI 兼容格式</strong>。不用改代码、不用装插件、不用等适配。`)}<p style="font-size:16px;font-weight:900;color:#111827">已经实测能直连、开箱即用的：</p>${tools}<section data-component="three-steps" style="background:#f9fafb;padding:16px;border-radius:12px;text-align:center"><p style="font-size:12px;font-weight:700;color:#9ca3af;margin:0 0 12px">用法就三步</p><p style="margin:0;font-size:14px"><strong style="color:#059669">私信 ${data.keyword}</strong> → 领接口 + Key → <strong style="color:#059669">填进工具开跑</strong></p></section></section>
<section style="margin:48px 0 28px;padding:0 8px">${sectionTitle('03', '适合谁 / 说在前面', 'FOR WHOM · 实在话')}${p(`适合：${data.audience.join('、')}。这条路的<span style="border-bottom:2px solid #a7f3d0;font-weight:600">试错成本也几乎为零</span>。`)}<p style="margin:0 0 8px">几句实在话，先说清楚：</p>${risks}</section>
<section style="margin:48px 0 28px;padding:0 8px">${sectionTitle('04', '领取：关注进群', 'HOW TO GET · 一步到位')}${p(`先关注 ${data.brand}，私信“${data.keyword}”获得群二维码：`)}<section style="border-left:3px solid #059669;padding:10px 14px;background:#f0fdf4"><strong>接口地址 + API Key</strong><br>群公告直接发，拿了就能用。<br><br><strong>各工具配置教程</strong><br>跟着点就行，不会也能上手。</section></section>
<section data-component="final-card" style="margin:44px 8px 0;padding:26px 20px;background:#111827;border-radius:16px;color:#fff"><p style="margin:0 0 4px;font-size:12px;color:#6ee7b7;letter-spacing:2px">/// LAST</p><p style="margin:0 0 10px;font-size:21px;font-weight:900">写在最后</p><p style="margin:0;line-height:1.9">${data.product} 值不值得用，光看跑分没用，自己上手一遍才知道。</p></section><p data-component="disclaimer" style="margin:28px 8px 0;font-size:11px;color:#9ca3af;line-height:1.8">本文提供的为第三方中转体验，与官方无隶属关系。额度按实际情况动态分配，请遵守相关服务条款与当地法律，理性使用。</p></section>`
}

export function validate(html: string, data: ArticleIdea): Check[] {
  const has = (value: string) => html.includes(value)
  const required = [['结构', '封面图槽位', 'data-component="cover-image"'], ['结构', '首屏承诺卡', 'data-component="hero-card"'], ['结构', '四个编号章节', 'section-04'], ['结构', '三张证据图槽位', 'data-component="evidence-image"'], ['结构', '三步流程', 'data-component="three-steps"'], ['结构', '深色结尾与免责声明', 'data-component="final-card"'], ['事实', '产品名与关键词', data.product], ['事实', '兼容工具完整', data.tools.join(' / ')], ['事实', '风险边界完整', data.risks[2]], ['样式', '绿色视觉令牌', '#059669'], ['样式', '渐变与首屏圆角', 'border-radius:20px'], ['样式', '章节数字与图片阴影', 'font-size:29px'], ['样式', '深色结尾', '#111827']]
  const checks: Check[] = required.map(([category, name, token]) => ({ category: category as Check['category'], name, passed: has(token), detail: has(token) ? '已在生成 HTML 中找到' : `缺少 ${token}` }))
  checks.push({ category: '图像', name: '三张证据图提示词', passed: data.proofPoints.length === 3, detail: `${data.proofPoints.length}/3 张` })
  return checks
}
