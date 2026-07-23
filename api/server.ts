import COS from 'cos-nodejs-sdk-v5'
import dotenv from 'dotenv'
import express from 'express'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { articleImageSlotError } from '../src/lib/articleIntegrity.ts'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const envPath = join(projectRoot, '.env')
const layoutsPath = join(projectRoot, 'layouts.json')
const distPath = join(projectRoot, 'dist')
dotenv.config({ path: envPath, override: true })

const app = express()
const port = Number(process.env.PORT ?? 8787)
const articleModel = process.env.ARTICLE_MODEL ?? 'gpt-5.6-terra'
const imageModel = process.env.IMAGE_MODEL ?? 'gpt-image-2'
const cosKeyPrefix = (process.env.COS_KEY_PREFIX ?? 'backups/').replace(/^\/+|\/+$/g, '')

type Facts = Record<string, unknown>
type Layout = { id: string; name: string; description: string; instruction: string; builtin?: boolean }
type ImageSlot = { slot: string; prompt: string }
type OpenAIImage = { b64_json?: string; url?: string }
type UploadImage = { key: string; dataUrl: string }

app.use(express.json({ limit: '45mb' }))
// #region debug-point cos-image-preview-receiver
app.post('/api/debug/cos-image-preview', (request, response) => {
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), ...request.body })
  void writeFile(join(projectRoot, 'trae-debug-log-cos-image-preview.ndjson'), `${payload}\n`, { flag: 'a' })
  response.sendStatus(204)
})
// #endregion debug-point cos-image-preview-receiver
app.use((request, response, next) => {
  const origin = request.headers.origin
  if (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})

function config() {
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/$/, '')
  if (!apiKey || !baseUrl) throw new Error('服务端尚未完成 OpenAI 配置')
  return { apiKey, baseUrl }
}

function cosConfig() {
  const SecretId = process.env.COS_SECRET_ID
  const SecretKey = process.env.COS_SECRET_KEY
  const Bucket = process.env.COS_BUCKET
  const Region = process.env.COS_REGION
  if (!SecretId || !SecretKey || !Bucket || !Region) throw new Error('服务端尚未完成 COS 配置')
  return { SecretId, SecretKey, Bucket, Region }
}

function isFacts(value: unknown): value is Facts {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readLayouts(): Promise<Layout[]> {
  try { return JSON.parse(await readFile(layoutsPath, 'utf8')) as Layout[] } catch { return [] }
}

async function writeLayouts(layouts: Layout[]) {
  await writeFile(layoutsPath, `${JSON.stringify(layouts, null, 2)}\n`, 'utf8')
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function openAI(path: string, body: object, attempt = 0): Promise<unknown> {
  const { apiKey, baseUrl } = config()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Error && error.name === 'AbortError') throw new Error('上游服务响应超时（120 秒），请检查网络或模型可用性')
    throw error
  }
  clearTimeout(timeout)
  if (response.status === 429 && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after'))
    const fallbackDelay = Math.min(30000, 3000 * 2 ** attempt)
    await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackDelay)
    return openAI(path, body, attempt + 1)
  }
  if (!response.ok) {
    const detail = (await response.text()).replace(/Bearer\s+\S+/gi, '[REDACTED]').slice(0, 500)
    throw new Error(`上游服务请求失败（${response.status}）：${detail || '未返回详情'}`)
  }
  return response.json() as Promise<unknown>
}

async function chat(system: string, user: string) {
  const payload = await openAI('/chat/completions', {
    model: articleModel,
    temperature: 0.35,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('上游服务未返回文本内容')
  return content
}

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.endsWith('.local') && !/^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  } catch { return false }
}

function parseStringOptions(content: string, key: 'titles' | 'options', count: number) {
  const parsed = (() => { try { return JSON.parse(content) } catch { return null } })()
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.[key]) ? parsed[key] : content.split(/\n+/)
  const options = values.map((item: unknown) => String(item).replace(/^\s*(?:\d+[.、)|]|[-*])\s*/, '').trim()).filter(Boolean).slice(0, count)
  if (options.length !== count) throw new Error(`模型未按要求返回 ${count} 个选项`)
  return options
}

function parseTitles(content: string) {
  const titles = parseStringOptions(content, 'titles', 3)
  if (titles.some((title) => title.replace(/[\s\p{P}\p{S}]/gu, '').length < 8 || title.replace(/[\s\p{P}\p{S}]/gu, '').length > 28)) throw new Error('标题模型未按要求返回 8-28 字标题')
  return titles
}

async function toPngDataUrl(image: OpenAIImage) {
  let source: Buffer
  if (image.b64_json) source = Buffer.from(image.b64_json, 'base64')
  else if (image.url) {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error('无法读取上游图片数据')
    source = Buffer.from(await response.arrayBuffer())
  } else throw new Error('上游服务未返回图片数据')
  const png = await sharp(source).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

function parseUploadImage(value: unknown): { key: string; body: Buffer; contentType: string } | null {
  if (!value || typeof value !== 'object') return null
  const { key, dataUrl } = value as UploadImage
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,180}\.(?:png|jpe?g|webp)$/i.test(key) || key.includes('..')) return null
  if (typeof dataUrl !== 'string') return null
  const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!matched) return null
  const body = Buffer.from(matched[2], 'base64')
  if (!body.length || body.length > 10 * 1024 * 1024) return null
  return { key, body, contentType: matched[1] }
}

function publicCosUrl(bucket: string, region: string, key: string) {
  return `https://${bucket}.cos.${region}.myqcloud.com/${key.split('/').map(encodeURIComponent).join('/')}`
}

const settingKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ARTICLE_MODEL', 'IMAGE_MODEL', 'COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION', 'COS_KEY_PREFIX'] as const
type SettingKey = typeof settingKeys[number]
const secretSettingKeys = new Set<SettingKey>(['OPENAI_API_KEY', 'COS_SECRET_ID', 'COS_SECRET_KEY'])

function envValue(content: string, key: SettingKey) {
  return content.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() || ''
}

function settingsResponse(content: string) {
  return Object.fromEntries(settingKeys.map((key) => [key, secretSettingKeys.has(key) ? '' : envValue(content, key)]))
}

async function readEnvContent() {
  try { return await readFile(envPath, 'utf8') }
  catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
    return settingKeys.map((key) => `${key}=${process.env[key] || ''}`).join('\n') + '\n'
  }
}

app.get('/api/settings', async (_, response) => {
  try { response.json({ settings: settingsResponse(await readEnvContent()) }) }
  catch { response.status(500).json({ error: '无法读取本地 .env 配置' }) }
})

app.post('/api/settings', async (request, response) => {
  const input = request.body?.settings
  // #region debug-point env-save-request
  const reportSettingsDebug = (event: string, detail: object = {}) => void writeFile(join(projectRoot, 'trae-debug-log-env-save-failure.ndjson'), `${JSON.stringify({ timestamp: new Date().toISOString(), event, envPath, cwd: process.cwd(), ...detail })}\n`, { flag: 'a' })
  reportSettingsDebug('request', { hasSettings: Boolean(input), keys: input && typeof input === 'object' ? Object.keys(input) : [] })
  // #endregion debug-point env-save-request
  if (!input || typeof input !== 'object' || Array.isArray(input)) return response.status(400).json({ error: 'settings 必须是配置对象' })
  try {
    let content = await readEnvContent()
    for (const key of settingKeys) {
      const value = input[key]
      if (typeof value !== 'string' || !value.trim()) continue
      const escaped = value.trim().replace(/[\r\n]/g, '')
      const pattern = new RegExp(`^${key}=.*$`, 'm')
      content = pattern.test(content) ? content.replace(pattern, `${key}=${escaped}`) : `${content.trimEnd()}\n${key}=${escaped}\n`
    }
    await writeFile(envPath, content, 'utf8')
    // #region debug-point env-save-success
    reportSettingsDebug('success', { contentLength: content.length })
    // #endregion debug-point env-save-success
    response.json({ ok: true, restartRequired: true })
  } catch (error) {
    // #region debug-point env-save-error
    reportSettingsDebug('error', { name: error instanceof Error ? error.name : 'Unknown', message: error instanceof Error ? error.message : String(error), code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '' })
    // #endregion debug-point env-save-error
    response.status(500).json({ error: '无法保存本地 .env 配置' })
  }
})

app.get('/api/layouts', async (_, response) => {
  try { response.json({ layouts: await readLayouts() }) } catch { response.status(500).json({ error: '无法读取排版模板' }) }
})

app.post('/api/layouts/from-url', async (request, response) => {
  const sourceUrl = typeof request.body?.url === 'string' ? request.body.url.trim() : ''
  if (!isPublicHttpUrl(sourceUrl)) return response.status(400).json({ error: '请输入可公开访问的 http 或 https 链接' })
  try {
    const page = await fetch(sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ArticleWorkflow/1.0' } })
    if (!page.ok) throw new Error(`链接读取失败（${page.status}）`)
    const html = (await page.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').slice(0, 20000)
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
    const content = await chat('你是微信公众号排版设计师。分析给定网页的视觉排版、颜色、标题层级、卡片和间距，转换成可复用的公众号 HTML 内联样式规范。不要照抄原文内容，不要输出 HTML，只输出 JSON：{"name":"...","description":"...","instruction":"..."}。name 不超过 16 字，instruction 必须具体说明颜色、层级、卡片、间距和图片槽位如何处理。', `网页链接：${sourceUrl}\n网页文本与结构：${html}\n可读文本：${text}`)
    const parsed = JSON.parse(content) as Partial<Layout>
    if (!parsed.name || !parsed.description || !parsed.instruction) throw new Error('AI 未返回有效排版规范')
    const layouts = await readLayouts()
    const layout = { id: `layout-${Date.now()}`, name: parsed.name.trim(), description: parsed.description.trim(), instruction: parsed.instruction.trim() }
    await writeLayouts([...layouts, layout])
    response.json({ layout })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : 'AI 吸收排版失败' }) }
})

app.delete('/api/layouts/:id', async (request, response) => {
  try {
    const layouts = await readLayouts()
    const target = layouts.find((layout) => layout.id === request.params.id)
    if (!target) return response.status(404).json({ error: '排版不存在' })
    if (target.builtin) return response.status(400).json({ error: '默认排版不可删除' })
    await writeLayouts(layouts.filter((layout) => layout.id !== target.id))
    response.json({ ok: true })
  } catch { response.status(500).json({ error: '无法删除排版' }) }
})

app.get('/api/health', (_, response) => {
  response.json({
    configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL),
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    baseUrlConfigured: Boolean(process.env.OPENAI_BASE_URL),
    cosConfigured: Boolean(process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY && process.env.COS_BUCKET && process.env.COS_REGION),
    articleModel,
    imageModel,
  })
})

app.post('/api/titles', async (request, response) => {
  const facts = request.body?.facts
  const sourceContext = typeof request.body?.sourceContext === 'string' ? request.body.sourceContext.trim().slice(0, 12000) : ''
  if (!isFacts(facts)) return response.status(400).json({ error: 'facts 必须是事实对象' })
  try {
    const instructions = '你是小红书爆款选题编辑，擅长把产品、科普、教育、商业、生活、文化、人物、事件和研究等不同主题转化成公众号标题。先判断内容类型，再从事实中找出最有传播价值的冲突、痛点、变化、利益、情绪或悬念；有研究时提炼反常识洞察，没有研究时绝不能强行写成论文或研究口吻。不要把事实逐字拼接成说明书式标题。标题必须短、口语、像真人会点开的内容，不要官方宣传腔，越通俗越好，像朋友发微信一样自然。优先使用这些高点击钩子结构但不要机械套模板："原来真正影响___的不是___""为什么越___，反而越___""别再以为___，研究发现___""___的人一定要知道""看似___，其实最容易___""___搞错了___年""___的真相，90%的人不知道""一篇文章讲透___"。三条标题分别采用：1）反常识冲突；2）具体人群痛点；3）悬念揭秘。标题要让读者立刻知道与自己有什么关系，同时留下一个没有完全说透的问题。禁止"赋能、重塑、引领、解锁、打造新范式、全面提升、值得关注"等空话，禁止标题党式虚假夸张、禁止虚构数字和结论。允许把论文结论做通俗化、情绪化、场景化表达，但事实边界不能变。输出严格为 JSON：{"titles":["标题1","标题2","标题3"]}。这是硬性格式，第一次就必须满足：只能有一个 JSON 对象；必须恰好 3 条字符串；每条去除标点、空格、表情后必须为 8-28 个汉字（不足 8 或超过 28 都算失败）；不得输出 Markdown、代码围栏、序号、引号包裹 JSON 之外的文字、分析过程或换行说明。生成前在内部检查三条标题的字数和三种角度，检查通过后再输出。'
    const content = await chat(instructions, `用户确认的事实：\n${JSON.stringify(facts)}\n\n链接或研究参考内容：\n${sourceContext || '无链接，请认真理解用户逐题确认的研究事实'}\n\n只输出符合硬性格式的 JSON，不要输出任何解释。`)
    try {
      response.json({ titles: parseTitles(content) })
    } catch {
      const repaired = await chat(instructions, `以下标题不符合要求。请完全重写，不要只增删几个字。只输出严格 JSON，不要 Markdown：{"titles":["标题1","标题2","标题3"]}。每条标题去除标点、空格和表情后必须为 8-28 个汉字；三条分别是反常识冲突、具体人群痛点、悬念揭秘。越通俗越好，像朋友发微信一样自然。不要重复原句，不要增加事实，不要输出分析过程。\n原候选：\n${content}\n\n用户确认的事实：\n${JSON.stringify(facts)}\n\n链接或研究参考内容：\n${sourceContext || '无'}`)
      try { response.json({ titles: parseTitles(repaired) }) } catch {
        const finalTitles = await chat(instructions, `只输出严格 JSON：{"titles":["标题1","标题2","标题3"]}。重新创作三条小红书式中文标题，每条去除标点和空格后必须是 8-28 个汉字。分别使用反常识冲突、具体人群痛点、悬念揭秘；越通俗越好，不得解释，不得 Markdown，不得虚构事实。事实：${JSON.stringify(facts)}`)
        response.json({ titles: parseTitles(finalTitles) })
      }
    }
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : '标题生成失败' }) }
})

app.post('/api/extract-idea', async (request, response) => {
  const sourceUrl = typeof request.body?.url === 'string' ? request.body.url.trim() : ''
  if (!isPublicHttpUrl(sourceUrl)) return response.status(400).json({ error: '请输入可公开访问的 http 或 https 链接' })
  try {
    const page = await fetch(sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 ArticleWorkflow/1.0' } })
    if (!page.ok) throw new Error(`链接读取失败（${page.status}）`)
    const contentType = page.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error('链接未返回可读取的网页文本')
    const html = await page.text()
    const wechatArticle = new URL(sourceUrl).hostname.endsWith('mp.weixin.qq.com')
      ? html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)(?=<div[^>]+id=["']js_tags_container["']|<div[^>]+id=["']js_pc_qr_code["']|<div[^>]+class=["'][^"']*rich_media_area_extra[^"]*["']|<\/body>)/i)?.[1]
      : undefined
    const source = wechatArticle || html
    const text = source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000)
    if (!text) throw new Error('链接中没有可提炼的文章正文')
    const idea = await chat('你是文章策划助手。根据网页内容提炼一句清晰的产品或文章想法，必须忠于原文，不得虚构数据或承诺。只输出一句中文，不要标题、引号、解释或 Markdown，限 80 字以内。', `网页链接：${sourceUrl}\n网页正文：${text}`)
    response.json({ idea: idea.replace(/\s+/g, ' ').slice(0, 160), context: text })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : '链接想法提炼失败' }) }
})

app.post('/api/question-options', async (request, response) => {
  const idea = typeof request.body?.idea === 'string' ? request.body.idea.trim() : ''
  const sourceContext = typeof request.body?.sourceContext === 'string' ? request.body.sourceContext.trim().slice(0, 12000) : ''
  const question = request.body?.question
  const answers = isFacts(request.body?.answers) ? request.body.answers : {}
  if (!idea || !question || typeof question.key !== 'string' || typeof question.label !== 'string' || typeof question.hint !== 'string') return response.status(400).json({ error: '必须提供想法、当前问题和已有确认信息' })
  try {
    const content = await chat('你是微信公众号文章策划助手。根据用户的一句想法、已经确认的信息和当前问题，给出恰好 4 个不同的、可直接选用的简短答案。不得虚构无法从想法推断的具体数据、客户、资质或承诺；信息不足时使用中性且可修改的表述。只输出 JSON：{"options":["...","...","...","..."]}。', `初始想法：${idea}\n链接参考内容（仅作背景；用户输入优先）：${sourceContext || '无'}\n已确认信息：${JSON.stringify(answers)}\n当前问题：${question.label}\n说明：${question.hint}`)
    response.json({ options: parseStringOptions(content, 'options', 4) })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : 'AI 选项生成失败' }) }
})

app.post('/api/article', async (request, response) => {
  const facts = request.body?.facts
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : ''
  const sourceContext = typeof request.body?.sourceContext === 'string' ? request.body.sourceContext.trim().slice(0, 12000) : ''
  const layoutInstruction = typeof request.body?.layoutInstruction === 'string' ? request.body.layoutInstruction.trim().slice(0, 3000) : '使用清晰、克制、适合手机阅读的内联排版。'
  if (!isFacts(facts) || !title) return response.status(400).json({ error: '必须提供确认后的 facts 对象和 title' })
  try {
    const html = await chat('你是公众号文章编辑。根据用户确认的事实和标题，独立撰写一篇完整原创文章；正文措辞、段落内容、卖点阐释、故事节奏必须由你动态生成，绝不能复用固定成品文案或固定句子。只输出可直接粘贴到公众号编辑器的内联 HTML，不要 Markdown、代码围栏或解释。严格执行用户选择的排版规范。先判断主题属于产品推广、知识科普、研究解读、观点评论、人物故事、事件分析、生活方式或其他类型，再选择匹配的叙事结构和语气，禁止把非产品主题硬写成产品推广或接口接入文章。必须按顺序保留：文章外层 section；h1 标题；紧随标题后的 <section data-component="cover-image"> 封面图槽位；主题导入卡；读者问题与核心观点；01 三项基于事实的核心发现、价值或论据与恰好三张 <section data-component="evidence-image"> 正文图片槽位；02 真实场景、影响或实践路径；03 适合人群、适用条件和风险边界；04 总结与下一步行动；结尾卡；必要的来源或免责声明。封面图槽位和 3 个正文图槽位不可省略，后续将替换为 COS 公共 HTTPS 图片。所有样式必须写在 style 属性中。没有事实支撑的证据、数字、功能、承诺或联系方式一律不写，不得编造；缺失信息使用中性表述。', `确认事实：\n${JSON.stringify(facts)}\n\n链接参考内容（仅作事实背景；用户确认事实优先，不得照抄或添加未确认事实）：\n${sourceContext || '无'}\n\n确认标题：${title}\n\n排版规范：${layoutInstruction}\n\n图片槽位只输出占位 section，不要 img 外链或 data URL。`)
    if (!/<(?:section|article|div)\b/i.test(html)) throw new Error('文章模型未返回 HTML')
    const slotError = articleImageSlotError(html)
    if (slotError) throw new Error(slotError)
    response.json({ html })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : '文章生成失败' }) }
})

app.post('/api/images', async (request, response) => {
  const slots = request.body?.slots
  const candidatesPerSlot = Number(request.body?.candidatesPerSlot ?? 4)
  if (!Number.isInteger(candidatesPerSlot) || candidatesPerSlot < 1 || candidatesPerSlot > 4) return response.status(400).json({ error: 'candidatesPerSlot 必须为 1 至 4 的整数' })
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 4 || !slots.every((item): item is ImageSlot => typeof item?.slot === 'string' && item.slot.trim() && typeof item?.prompt === 'string' && item.prompt.trim())) return response.status(400).json({ error: 'slots 必须包含 1 至 4 个图位，每项需提供 slot 和 prompt' })
  const names = slots.map((item: ImageSlot) => item.slot.trim())
  const validSlots = new Set(['cover', 'evidence-1', 'evidence-2', 'evidence-3'])
  if (names.some((name: string) => !validSlots.has(name)) || new Set(names).size !== names.length) return response.status(400).json({ error: '图位必须是唯一的 cover、evidence-1、evidence-2 或 evidence-3' })
  try {
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()
    const requests = slots.flatMap((slot: ImageSlot) => Array.from({ length: candidatesPerSlot }, (_, index) => ({ slot, index })))
    const generated: Array<{ slot: string; index: number; dataUrl: string }> = []
    let workerPoolStarted = false
    const worker = async () => {
      if (!workerPoolStarted) {
        workerPoolStarted = true
        await Promise.all(Array.from({ length: Math.min(8, requests.length) }, () => worker()))
        return
      }
      while (requests.length) {
        const task = requests.shift()!
        const payload = await openAI('/images/generations', {
          model: imageModel,
          prompt: `${task.slot.prompt.trim()} 这是第 ${task.index + 1} 个候选，请改变主体动作、视角、光线和构图，但保持同一研究洞察与视觉隐喻。图片中的中文必须保持清晰、完整、可读，不要替换或删改指定标题。`,
          size: task.slot.slot.trim() === 'cover' ? '1536x1024' : '1024x1024',
          response_format: 'b64_json',
        }) as { data?: OpenAIImage[] }
        const image = payload.data?.[0]
        if (!image) throw new Error(`${task.slot.slot} 未返回第 ${task.index + 1} 张候选图`)
        const dataUrl = await toPngDataUrl(image)
        generated.push({ slot: task.slot.slot.trim(), index: task.index, dataUrl })
        response.write(`${JSON.stringify({ type: 'image', slot: task.slot.slot.trim(), index: task.index, dataUrl })}\n`)
      }
    }
    await worker()
    response.write(`${JSON.stringify({ type: 'complete' })}\n`)
    response.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片生成失败'
    if (response.headersSent) { response.write(`${JSON.stringify({ type: 'error', error: message })}\n`); response.end() } else response.status(422).json({ error: message })
  }
})

app.post('/api/upload-images', async (request, response) => {
  const images = request.body?.images
  if (!Array.isArray(images) || images.length < 1 || images.length > 4) return response.status(400).json({ error: 'images 必须包含 1 至 4 张已选择图片的 dataUrl 和 key' })
  const parsed = images.map(parseUploadImage)
  if (parsed.some((image) => !image) || new Set(parsed.map((image) => image!.key)).size !== images.length) return response.status(400).json({ error: '图片数据或对象键不合法' })
  try {
    const { SecretId, SecretKey, Bucket, Region } = cosConfig()
    const client = new COS({ SecretId, SecretKey })
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    await Promise.all(parsed.map(async (image) => {
      const key = [cosKeyPrefix, image!.key].filter(Boolean).join('/')
      await new Promise<void>((resolve, reject) => client.putObject({ Bucket, Region, Key: key, Body: image!.body, ContentType: image!.contentType }, (error) => error ? reject(error) : resolve()))
      const url = publicCosUrl(Bucket, Region, key)
      response.write(`${JSON.stringify({ type: 'uploaded', key: image!.key, url })}\n`)
    }))
    response.end()
  } catch (error) { response.write(`${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'COS 上传失败' })}\n`); response.end() }
})

app.use(express.static(distPath))
app.get('/{*path}', (_, response) => response.sendFile(join(distPath, 'index.html')))

app.listen(port, '0.0.0.0', () => console.log(`服务已启动：http://0.0.0.0:${port}`))
