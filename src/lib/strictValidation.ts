import goldenArticle from '../../Grok-4.5-公众号复刻.md?raw'

export type ArticleStrictResult = { passed: boolean; generatedHash: string; referenceHash: string; detail: string }

const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim()

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function validateArticleStrictly(article: string): Promise<ArticleStrictResult> {
  const [generatedHash, referenceHash] = await Promise.all([sha256(normalize(article)), sha256(normalize(goldenArticle))])
  const passed = normalize(article) === normalize(goldenArticle)
  return { passed, generatedHash, referenceHash, detail: passed ? '规范化 HTML 逐字符一致' : '生成文章与黄金参考文章不一致' }
}

export { goldenArticle }
