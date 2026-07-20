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
  sectionIndex: number
  confirmedSections: boolean[]
  html: string
  imageCandidates: Partial<Record<CandidateSlot, string[]>>
  selectedImages: Partial<Record<CandidateSlot, number>>
  uploadedImages: Partial<Record<CandidateSlot, string>>
}

export const storageKey = 'wechat-article-local-workflow-v2'

export const questions: { key: QuestionKey; label: string; hint: string }[] = [
  { key: 'product', label: '产品', hint: '它是什么？请用一句话说明产品或服务。' },
  { key: 'audience', label: '受众', hint: '这篇文章主要写给谁看？' },
  { key: 'pain', label: '痛点', hint: '他们当前最想解决的麻烦是什么？' },
  { key: 'sellingPoint', label: '卖点', hint: '为什么值得选择？写出核心优势。' },
  { key: 'claim', label: '领取', hint: '读者如何领取、试用或下一步行动？' },
  { key: 'risk', label: '风险', hint: '有哪些边界、限制或需要提前说明的风险？' },
  { key: 'brand', label: '品牌', hint: '以什么品牌或账号名发布？' },
]

export const sectionNames = ['开场与核心承诺', '证据与产品价值', '接入方式与风险说明', '领取方式与结尾']

export function emptySession(): WorkflowSession {
  return { stage: 'idea', idea: '', sourceContext: '', answers: { product: '', audience: '', pain: '', sellingPoint: '', claim: '', risk: '', brand: '' }, factsConfirmed: Array(7).fill(false), generatedTitles: [], selectedTitle: null, sectionIndex: 0, confirmedSections: Array(4).fill(false), html: '', imageCandidates: {}, selectedImages: {}, uploadedImages: {} }
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
    产品: data.product,
    受众: data.audience.join('、'),
    痛点: data.painPoints.join('、'),
    核心卖点: data.solution,
    领取方式: session.answers.claim || `私信“${data.keyword}”`,
    风险与品牌: `${data.risks.join('；')}；${data.brand}`,
  }
}

