import { goldenArticlePrompt, parseIdea, renderArticle } from '../src/lib/articleEngine.ts'
import { articleImageSlotError, hasPublishedArticleImages } from '../src/lib/articleIntegrity.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(goldenArticlePrompt.includes('data-component="cover-image"'), 'AI 文章提示词必须要求封面图槽位')
const article = renderArticle(parseIdea('为开发者提供低门槛 AI 工具试用入口'))
assert(!articleImageSlotError(article), '固定文章模板必须包含封面和 3 个正文图片槽位')

const urls = ['cover', 'evidence-1', 'evidence-2', 'evidence-3'].map((slot) => `https://example-1250000000.cos.ap-guangzhou.myqcloud.com/articles/${slot}.png`)
let urlIndex = 0
const publishedArticle = article.replace(/证据图槽位 · [^<]+|封面图槽位 · 2\.35:1/g, () => `<img src="${urls[urlIndex++]}" alt="验证图片">`)
assert(hasPublishedArticleImages(publishedArticle), '上传后的 HTML 必须至少包含封面和 3 个正文公共 HTTPS 图片')

console.log('文章图片完整性验证通过：封面槽位、3 个正文槽位及 4 个公共 HTTPS 图片均存在。')
