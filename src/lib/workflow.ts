import { parseIdea, type ArticleIdea } from '@/lib/articleEngine'

export type QuestionKey = 'product' | 'audience' | 'pain' | 'sellingPoint' | 'claim' | 'risk' | 'brand'
export type WorkflowStage = 'idea' | 'questions' | 'facts' | 'titles' | 'sections' | 'editor'

export type CandidateSlot = 'cover' | 'evidence-1' | 'evidence-2' | 'evidence-3'
export type WorkflowSession = {
  stage: WorkflowStage
  idea: string
  sourceContext: string
  answers: Record<QuestionKey, string>
  factsConfirmed: boolean[]
  generatedTitles: string[]
  selectedTitle: number | null
  layoutId: string
  layoutInstruction: string
  sectionIndex: number
  confirmedSections: boolean[]
  html: string
  imageCandidates: Partial<Record<CandidateSlot, string[]>>
  selectedImages: Partial<Record<CandidateSlot, number>>
  uploadedImages: Partial<Record<CandidateSlot, string>>
}

export const storageKey = 'wechat-article-local-workflow-v2'

export const questions: { key: QuestionKey; label: string; hint: string }[] = [
  { key: 'product', label: '主题', hint: '这篇文章要讲什么主题、产品、服务或事件？' },
  { key: 'audience', label: '受众', hint: '这篇文章主要写给谁看？' },
  { key: 'pain', label: '读者问题', hint: '读者最关心的问题、误区或现实困扰是什么？' },
  { key: 'sellingPoint', label: '核心价值', hint: '最值得读者记住的发现、观点或价值是什么？' },
  { key: 'claim', label: '下一步', hint: '读完后希望读者理解、尝试或采取什么行动？' },
  { key: 'risk', label: '边界', hint: '有哪些限制、争议、适用条件或风险需要说明？' },
  { key: 'brand', label: '署名', hint: '以什么品牌、机构、作者或账号名发布？' },
]

export const sectionNames = ['开场与核心观点', '事实、发现与价值', '实际影响与边界', '行动建议与结尾']

export function emptySession(): WorkflowSession {
  return { stage: 'idea', idea: '', sourceContext: '', answers: { product: '', audience: '', pain: '', sellingPoint: '', claim: '', risk: '', brand: '' }, factsConfirmed: Array(7).fill(false), generatedTitles: [], selectedTitle: null, layoutId: 'green-tech-default', layoutInstruction: '', sectionIndex: 0, confirmedSections: Array(4).fill(false), html: '', imageCandidates: {}, selectedImages: {}, uploadedImages: {} }
}

export function restoreSession(value: unknown): WorkflowSession {
  const base = emptySession()
  if (!value || typeof value !== 'object') return base
  const saved = value as Partial<WorkflowSession>
  return {
    ...base,
    ...saved,
    answers: { ...base.answers, ...(saved.answers || {}) },
    factsConfirmed: Array.isArray(saved.factsConfirmed) ? saved.factsConfirmed : base.factsConfirmed,
    generatedTitles: Array.isArray(saved.generatedTitles) ? saved.generatedTitles.filter((title): title is string => typeof title === 'string') : [],
    confirmedSections: Array.isArray(saved.confirmedSections) ? saved.confirmedSections : base.confirmedSections,
    imageCandidates: saved.imageCandidates || {},
    selectedImages: saved.selectedImages || {},
    uploadedImages: saved.uploadedImages || {},
  }
}

export function articleData(session: WorkflowSession): ArticleIdea {
  const fallback = parseIdea(session.idea || '你的 AI 产品')
  const answers = session.answers
  const product = answers.product || fallback.product
  const audience = answers.audience ? answers.audience.split(/[、，,]/).map((item) => item.trim()).filter(Boolean) : fallback.audience
  const painPoints = answers.pain ? answers.pain.split(/[、，,。]/).map((item) => item.trim()).filter(Boolean) : fallback.painPoints
  const keyword = answers.claim.match(/私信[“"]?([^”"，、；; ]+)/)?.[1] || fallback.keyword
  return {
    ...fallback,
    raw: session.idea,
    product,
    audience,
    painPoints,
    solution: answers.sellingPoint || fallback.solution,
    accessStandard: answers.sellingPoint || fallback.accessStandard,
    keyword,
    risks: answers.risk ? answers.risk.split(/[、，,。]/).map((item) => item.trim()).filter(Boolean) : fallback.risks,
    brand: answers.brand || fallback.brand,
    brandSlogan: answers.brand ? '与你一起把好产品说清楚' : fallback.brandSlogan,
  }
}

export function factsFor(session: WorkflowSession): Record<string, string> {
  const data = articleData(session)
  return {
    初始想法: session.idea,
    主题: data.product,
    受众: data.audience.join('、'),
    读者问题: data.painPoints.join('、'),
    核心价值: data.solution,
    下一步行动: session.answers.claim || '根据文章内容理解或采取适合自己的下一步',
    边界与署名: `${data.risks.join('；')}；${data.brand}`,
  }
}

