import COS from 'cos-nodejs-sdk-v5'
import dotenv from 'dotenv'
import express from 'express'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { articleImageSlotError } from '../src/lib/articleIntegrity.ts'

const envPath = fileURLToPath(new URL('../.env', import.meta.url))
dotenv.config({ path: envPath, override: true })

const app = express()
const port = Number(process.env.PORT ?? 8787)
const articleModel = process.env.ARTICLE_MODEL ?? 'gpt-5.6-terra'
const imageModel = process.env.IMAGE_MODEL ?? 'gpt-image-2'
const cosKeyPrefix = (process.env.COS_KEY_PREFIX ?? 'backups/').replace(/^\/+|\/+$/g, '')

type Facts = Record<string, unknown>
type ImageSlot = { slot: string; prompt: string }
type OpenAIImage = { b64_json?: string; url?: string }
type UploadImage = { key: string; dataUrl: string }

app.use(express.json({ limit: '45mb' }))
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

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function openAI(path: string, body: object, attempt = 0): Promise<unknown> {
  const { apiKey, baseUrl } = config()
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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
  if (titles.some((title) => title.replace(/[\s\p{P}\p{S}]/gu, '').length < 18 || title.replace(/[\s\p{P}\p{S}]/gu, '').length > 28)) throw new Error('标题模型未按要求返回 18-28 字标题')
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

app.get('/api/settings', async (_, response) => {
  try { response.json({ settings: settingsResponse(await readFile(envPath, 'utf8')) }) }
  catch { response.status(500).json({ error: '无法读取本地 .env 配置' }) }
})

app.post('/api/settings', async (request, response) => {
  const input = request.body?.settings
  if (!input || typeof input !== 'object' || Array.isArray(input)) return response.status(400).json({ error: 'settings 必须是配置对象' })
  try {
    let content = await readFile(envPath, 'utf8')
    for (const key of settingKeys) {
      const value = input[key]
      if (typeof value !== 'string' || !value.trim()) continue
      const escaped = value.trim().replace(/[\r\n]/g, '')
      const pattern = new RegExp(`^${key}=.*$`, 'm')
      content = pattern.test(content) ? content.replace(pattern, `${key}=${escaped}`) : `${content.trimEnd()}\n${key}=${escaped}\n`
    }
    await writeFile(envPath, content, 'utf8')
    response.json({ ok: true, restartRequired: true })
  } catch { response.status(500).json({ error: '无法保存本地 .env 配置' }) }
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
    const instructions = '你是微信公众号标题编辑。只能依据用户提供的事实，不得补充、猜测或夸大。输出严格为 JSON：{"titles":["...","...","..."]}。每个标题去除标点后必须为 18-28 个汉字或等效中文字符，痛点共鸣风格，三个标题角度不同。'
    const content = await chat(instructions, `用户确认的事实：\n${JSON.stringify(facts)}\n\n链接参考内容（仅作事实背景；用户确认事实优先）：\n${sourceContext || '无'}`)
    try {
      response.json({ titles: parseTitles(content) })
    } catch {
      const repaired = await chat(instructions, `以下标题不符合长度要求。只输出修正后的 JSON，确保每条去除标点后严格为 18-28 个中文字符，且不增加事实：\n${content}\n\n用户确认的事实：\n${JSON.stringify(facts)}\n\n链接参考内容（仅作事实背景；用户确认事实优先）：\n${sourceContext || '无'}`)
      response.json({ titles: parseTitles(repaired) })
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
  if (!isFacts(facts) || !title) return response.status(400).json({ error: '必须提供确认后的 facts 对象和 title' })
  try {
    const html = await chat('你是公众号文章编辑。根据用户确认的事实和标题，独立撰写一篇完整原创文章；正文措辞、段落内容、卖点阐释、故事节奏必须由你动态生成，绝不能复用固定成品文案或固定句子。只输出可直接粘贴到公众号编辑器的内联 HTML，不要 Markdown、代码围栏或解释。使用绿色科技风视觉，但每次根据主题灵活组织内容。必须按顺序保留：文章外层 section；h1 标题；紧随标题后的 <section data-component="cover-image"> 封面图槽位；首屏承诺卡；痛点与解决方案；01 三项基于事实的产品价值与恰好三张 <section data-component="evidence-image"> 正文图片槽位；02 使用或接入路径；03 适合人群和风险边界；04 下一步行动；深色结尾卡；免责声明。封面图槽位和 3 个正文图槽位不可省略，后续将替换为 COS 公共 HTTPS 图片。所有样式必须写在 style 属性中。没有事实支撑的证据、数字、功能、承诺或联系方式一律不写，不得编造；缺失信息使用中性表述。', `确认事实：\n${JSON.stringify(facts)}\n\n链接参考内容（仅作事实背景；用户确认事实优先，不得照抄或添加未确认事实）：\n${sourceContext || '无'}\n\n确认标题：${title}\n\n图片槽位只输出占位 section，不要 img 外链或 data URL。`)
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
    const requests = slots.flatMap((slot: ImageSlot) => Array.from({ length: candidatesPerSlot }, (_, index) => ({ slot, index })))
    const generated: Array<{ slot: string; index: number; dataUrl: string }> = []
    const worker = async () => {
      while (requests.length) {
        const task = requests.shift()!
        const payload = await openAI('/images/generations', {
          model: imageModel,
          prompt: `${task.slot.prompt.trim()}。生成第 ${task.index + 1} 个不同构图候选。`,
          size: task.slot.slot.trim() === 'cover' ? '1536x1024' : '1024x1024',
          response_format: 'b64_json',
        }) as { data?: OpenAIImage[] }
        const image = payload.data?.[0]
        if (!image) throw new Error(`${task.slot.slot} 未返回第 ${task.index + 1} 张候选图`)
        generated.push({ slot: task.slot.slot.trim(), index: task.index, dataUrl: await toPngDataUrl(image) })
      }
    }
    await worker()
    const results = slots.map((slot: ImageSlot) => ({
      slot: slot.slot.trim(),
      prompt: slot.prompt.trim(),
      candidates: generated.filter((item) => item.slot === slot.slot.trim()).sort((left, right) => left.index - right.index).map((item) => item.dataUrl),
    }))
    response.json({ images: results })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : '图片生成失败' }) }
})

app.post('/api/upload-images', async (request, response) => {
  const images = request.body?.images
  if (!Array.isArray(images) || images.length !== 4) return response.status(400).json({ error: 'images 必须包含 4 张图片的 dataUrl 和 key' })
  const parsed = images.map(parseUploadImage)
  if (parsed.some((image) => !image) || new Set(parsed.map((image) => image!.key)).size !== 4) return response.status(400).json({ error: '图片数据或对象键不合法' })
  try {
    const { SecretId, SecretKey, Bucket, Region } = cosConfig()
    const client = new COS({ SecretId, SecretKey })
    const uploaded = await Promise.all(parsed.map(async (image) => {
      const key = [cosKeyPrefix, image!.key].filter(Boolean).join('/')
      await new Promise<void>((resolve, reject) => client.putObject({ Bucket, Region, Key: key, Body: image!.body, ContentType: image!.contentType }, (error) => error ? reject(error) : resolve()))
      return { key: image!.key, url: publicCosUrl(Bucket, Region, key) }
    }))
    response.json({ images: uploaded })
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : 'COS 上传失败' }) }
})

app.listen(port, () => console.log(`本地 API：http://127.0.0.1:${port}`))
