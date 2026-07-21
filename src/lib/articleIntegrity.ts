export const coverImageComponent = 'data-component="cover-image"'
export const evidenceImageComponent = 'data-component="evidence-image"'

export function articleImageSlotError(html: string) {
  if (!html.includes(coverImageComponent)) return '文章缺少 data-component="cover-image" 封面图槽位'
  const evidenceCount = html.split(evidenceImageComponent).length - 1
  if (evidenceCount !== 3) return `文章必须包含 3 个正文图片槽位，当前为 ${evidenceCount} 个`
  return ''
}

export function hasPublishedArticleImages(html: string) {
  if (articleImageSlotError(html)) return false
  const publicImages = html.match(/<img\b[^>]*\bsrc=["']https:\/\/[^"']+["'][^>]*>/gi) ?? []
  return publicImages.length > 0
}

type ArticleImageMap = Partial<Record<'cover' | 'evidence-1' | 'evidence-2' | 'evidence-3', string>>

export function replaceArticleImages(html: string, images: ArticleImageMap) {
  const slotError = articleImageSlotError(html)
  if (slotError) throw new Error(slotError)
  if (!Object.keys(images).length || Object.values(images).some((url) => typeof url !== 'string' || !/^https:\/\//.test(url))) throw new Error('上传结果必须包含至少 1 个公共 HTTPS 图片链接')
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (images.cover) {
    const cover = document.querySelector('[data-component="cover-image"]')!
    cover.innerHTML = `<img src="${images.cover}" alt="文章封面" style="display:block;width:100%;aspect-ratio:2.35/1;object-fit:cover">`
  }
  document.querySelectorAll('[data-component="evidence-image"]').forEach((element, index) => {
    const source = images[`evidence-${index + 1}` as 'evidence-1' | 'evidence-2' | 'evidence-3']
    if (source) element.innerHTML = `<img src="${source}" alt="文章正文配图 ${index + 1}" style="display:block;width:100%;height:auto;border-radius:8px">`
  })
  return document.body.innerHTML
}
