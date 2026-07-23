import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Clipboard, FileDown, FileText, PenLine, RotateCcw, Settings, Sparkles, X } from 'lucide-react'
import { replaceArticleImages } from '@/lib/articleIntegrity'
import { emptySession, factsFor, questions, restoreSession, storageKey, type CandidateSlot, type WorkflowSession } from '@/lib/workflow'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('React error:', error, info) }
  render() {
    if (this.state.error) return <main className="workspace" style={{ padding: 40 }}><h2>页面出错了</h2><p>{this.state.error.message}</p><button onClick={() => { this.setState({ error: null }); location.reload() }} style={{ padding: '8px 16px', borderRadius: 8, background: '#111', color: '#fff', border: 'none', cursor: 'pointer' }}>刷新页面</button></main>
    return this.props.children
  }
}

const stageLabels = ['一句想法', '逐题追问', '标题三选一', '完成编辑']
const stageOrder: Record<WorkflowSession['stage'], number> = { idea: 0, questions: 1, facts: 1, titles: 2, sections: 2, editor: 3 }
type AppSettings = Record<'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'ARTICLE_MODEL' | 'IMAGE_MODEL' | 'COS_SECRET_ID' | 'COS_SECRET_KEY' | 'COS_BUCKET' | 'COS_REGION' | 'COS_KEY_PREFIX', string>
type Layout = { id: string; name: string; description: string; instruction: string; builtin?: boolean }
const emptySettings: AppSettings = { OPENAI_API_KEY: '', OPENAI_BASE_URL: '', ARTICLE_MODEL: '', IMAGE_MODEL: '', COS_SECRET_ID: '', COS_SECRET_KEY: '', COS_BUCKET: '', COS_REGION: '', COS_KEY_PREFIX: '' }
const settingFields: Array<{ key: keyof AppSettings; label: string; secret?: boolean; placeholder?: string }> = [
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', secret: true, placeholder: '留空则保留现有密钥' }, { key: 'OPENAI_BASE_URL', label: 'OpenAI Base URL' }, { key: 'ARTICLE_MODEL', label: '文章模型' }, { key: 'IMAGE_MODEL', label: '图片模型' },
  { key: 'COS_SECRET_ID', label: 'COS Secret ID', secret: true, placeholder: '留空则保留现有密钥' }, { key: 'COS_SECRET_KEY', label: 'COS Secret Key', secret: true, placeholder: '留空则保留现有密钥' }, { key: 'COS_BUCKET', label: 'COS Bucket' }, { key: 'COS_REGION', label: 'COS Region' }, { key: 'COS_KEY_PREFIX', label: 'COS 路径前缀' },
]

const imageSlots: Array<{ slot: CandidateSlot; label: string; ratio?: string }> = [
  { slot: 'cover', label: '封面图', ratio: '2.35:1' },
  { slot: 'evidence-1', label: '证据图 1' },
  { slot: 'evidence-2', label: '证据图 2' },
  { slot: 'evidence-3', label: '证据图 3' },
]

export default function Home() {
  const [session, setSession] = useState<WorkflowSession>(() => {
    try { return restoreSession(JSON.parse(localStorage.getItem(storageKey) || 'null')) } catch { return emptySession() }
  })
  const [copied, setCopied] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [extractBusy, setExtractBusy] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [generationBusy, setGenerationBusy] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [questionOptions, setQuestionOptions] = useState<string[]>([])
  const [questionBusy, setQuestionBusy] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [customAnswer, setCustomAnswer] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageStarted, setImageStarted] = useState(false)
  const [imagePending, setImagePending] = useState<Record<string, boolean>>({})
  const [imageError, setImageError] = useState('')
  const [imageStep, setImageStep] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(emptySettings)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [layoutUrl, setLayoutUrl] = useState('')
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [layoutMessage, setLayoutMessage] = useState('')
  const facts = useMemo(() => factsFor(session), [session])
  const titles = session.generatedTitles
  const activeTitle = session.selectedTitle !== null ? titles[session.selectedTitle] : customTitle.trim()
  const html = session.html
  const questionIndex = questions.findIndex((question) => !session.answers[question.key])
  const currentQuestion = questions[Math.max(0, questionIndex)]
  const confirmedContext = questions.slice(0, Math.max(0, questionIndex)).map((question) => ({ label: question.label, value: session.answers[question.key] })).filter((item) => item.value)
  const set = (update: Partial<WorkflowSession>) => setSession((current) => ({ ...current, ...update }))

  useEffect(() => {
    try {
      const { imageCandidates, ...rest } = session
      // 清除 html 中嵌入的 base64 图片数据，避免超出 localStorage 5MB 配额
      const htmlForStorage = rest.html.replace(/src="data:image\/[^;]+;base64,[^"]+"/g, 'src=""')
      localStorage.setItem(storageKey, JSON.stringify({ ...rest, html: htmlForStorage }))
    } catch (e) {
      console.warn('localStorage 持久化失败，跳过本次写入', e)
    }
  }, [session])
  // #region debug-point cos-image-preview-listeners
  useEffect(() => {
    const preview = document.querySelector('.article-preview')
    const images = Array.from(preview?.querySelectorAll('img') || [])
    const onLoad = (event: Event) => reportPreviewImage('load', event.currentTarget as HTMLImageElement)
    const onError = (event: Event) => reportPreviewImage('error', event.currentTarget as HTMLImageElement)
    images.forEach((image) => { image.addEventListener('load', onLoad); image.addEventListener('error', onError); if (image.complete) reportPreviewImage(image.naturalWidth ? 'load' : 'error', image) })
    return () => images.forEach((image) => { image.removeEventListener('load', onLoad); image.removeEventListener('error', onError) })
  }, [html, session.uploadedImages])
  // #endregion debug-point cos-image-preview-listeners

  const openSettings = async () => {
    setSettingsOpen(true); setSettingsBusy(true); setSettingsMessage(''); void loadLayouts()
    try {
      const response = await fetch('/api/settings')
      const payload = await response.json() as { settings?: AppSettings; error?: string }
      if (!response.ok || !payload.settings) throw new Error(payload.error || '读取设置失败')
      setSettings({ ...emptySettings, ...payload.settings })
    } catch (error) { setSettingsMessage(error instanceof Error ? error.message : '读取设置失败') } finally { setSettingsBusy(false) }
  }
  const loadLayouts = async () => {
    try { const response = await fetch('/api/layouts'); const payload = await response.json() as { layouts?: Layout[] }; if (response.ok) setLayouts(payload.layouts || []) } catch { setLayoutMessage('排版列表读取失败') }
  }
  const absorbLayout = async () => {
    if (!layoutUrl.trim()) return
    setLayoutBusy(true); setLayoutMessage('')
    try {
      const response = await fetch('/api/layouts/from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: layoutUrl }) })
      const payload = await response.json() as { layout?: Layout; error?: string }
      if (!response.ok || !payload.layout) throw new Error(payload.error || 'AI 吸收排版失败')
      setLayouts((current) => [...current, payload.layout!]); setLayoutUrl(''); setLayoutMessage('已添加排版，可在文章生成前选择')
    } catch (error) { setLayoutMessage(error instanceof Error ? error.message : 'AI 吸收排版失败') } finally { setLayoutBusy(false) }
  }
  const deleteLayout = async (id: string) => {
    try { const response = await fetch(`/api/layouts/${id}`, { method: 'DELETE' }); if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error || '删除排版失败') }; setLayouts((current) => current.filter((layout) => layout.id !== id)); if (session.layoutId === id) set({ layoutId: 'green-tech-default', layoutInstruction: '' }) } catch (error) { setLayoutMessage(error instanceof Error ? error.message : '删除排版失败') }
  }
  useEffect(() => { void loadLayouts() }, [])

  const saveSettings = async () => {
    setSettingsBusy(true); setSettingsMessage('')
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })
      const payload = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.error || '保存设置失败')
      setSettingsMessage('已保存到本机 .env。请重启 API 服务后生效。')
      setSettings((current) => ({ ...current, OPENAI_API_KEY: '', COS_SECRET_ID: '', COS_SECRET_KEY: '' }))
    } catch (error) { setSettingsMessage(error instanceof Error ? error.message : '保存设置失败') } finally { setSettingsBusy(false) }
  }
  const startQuestions = () => { if (session.idea.trim()) { setQuestionOptions([]); setQuestionError(''); setCustomAnswer(''); set({ stage: 'questions' }) } }
  const extractIdea = async () => {
    if (!sourceUrl.trim()) return
    setExtractBusy(true); setExtractError('')
    try {
      const response = await fetch('/api/extract-idea', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sourceUrl }) })
      const payload = await response.json() as { idea?: string; context?: string; error?: string }
      if (!response.ok || !payload.idea) throw new Error(payload.error || '链接想法提炼失败')
      set({ idea: payload.idea, sourceContext: payload.context || '' })
    } catch (error) { setExtractError(error instanceof Error ? error.message : '链接想法提炼失败') } finally { setExtractBusy(false) }
  }
  const saveAnswer = (value: string) => {
    if (!currentQuestion || !value.trim()) return
    const answers = { ...session.answers, [currentQuestion.key]: value.trim() }
    setQuestionOptions([]); setQuestionError(''); setCustomAnswer('')
    if (questions.every((question) => answers[question.key])) {
      setSession((current) => ({ ...current, answers }))
      void generateTitles(factsFor({ ...session, answers }))
      return
    }
    set({ answers, stage: 'questions' })
  }
  const generateQuestionOptions = async () => {
    if (!currentQuestion) return
    setQuestionBusy(true); setQuestionError(''); setQuestionOptions([])
    try {
      const response = await fetch('/api/question-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: session.idea, sourceContext: session.sourceContext, question: currentQuestion, answers: session.answers }) })
      const payload = await response.json() as { options?: string[]; error?: string }
      if (!response.ok || !Array.isArray(payload.options) || payload.options.length !== 4) throw new Error(payload.error || 'AI 选项生成失败')
      setQuestionOptions(payload.options)
      setCustomAnswer(payload.options[0])
    } catch (error) { setQuestionError(error instanceof Error ? error.message : 'AI 选项生成失败') } finally { setQuestionBusy(false) }
  }
  useEffect(() => {
    if (session.stage === 'questions' && session.sourceContext && currentQuestion) void generateQuestionOptions()
  }, [session.stage, session.sourceContext, currentQuestion?.key])

  const generateTitles = async (writingFacts = facts) => {
    setGenerationBusy(true); setGenerationError('')
    try {
      const response = await fetch('/api/titles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: writingFacts, sourceContext: session.sourceContext }) })
      const payload = await response.json() as { titles?: string[]; error?: string }
      if (!response.ok || !Array.isArray(payload.titles) || payload.titles.length !== 3) throw new Error(payload.error || '标题生成失败')
      set({ generatedTitles: payload.titles, stage: 'titles' })
    } catch (error) { setGenerationError(error instanceof Error ? error.message : '标题生成失败') } finally { setGenerationBusy(false) }
  }
  const chooseTitle = async (index: number) => {
    const title = titles[index]
    if (!title) return
    await generateArticle(title, index)
  }
  const chooseCustomTitle = async () => {
    const title = customTitle.trim()
    if (!title) return
    await generateArticle(title, null)
  }
  const generateArticle = async (title: string, selectedTitle: number | null, retry = 0) => {
    setGenerationBusy(true); setGenerationError('')
    try {
      const selectedLayout = layouts.find((layout) => layout.id === session.layoutId) || layouts[0]
      const response = await fetch('/api/article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, title, sourceContext: session.sourceContext, layoutInstruction: selectedLayout?.instruction || session.layoutInstruction }) })
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error || `文章生成失败（${response.status}）`) }
      const payload = await response.json() as { html?: string; error?: string }
      if (!payload.html) throw new Error(payload.error || '文章模型未返回 HTML')
      set({ selectedTitle, stage: 'editor', html: payload.html, imageCandidates: {}, selectedImages: {}, uploadedImages: {} })
    } catch (error) {
      const message = error instanceof Error ? error.message : '文章生成失败'
      if (retry < 2 && (message.includes('fetch') || message.includes('Failed'))) {
        await new Promise((r) => setTimeout(r, 2000))
        return generateArticle(title, selectedTitle, retry + 1)
      }
      setGenerationError(message)
    } finally { setGenerationBusy(false) }
  }
  const changeLayout = async (layoutId: string) => {
    const title = activeTitle
    const layout = layouts.find((item) => item.id === layoutId)
    if (!title || !layout || layoutId === session.layoutId) return
    setGenerationBusy(true); setGenerationError('')
    try {
      const response = await fetch('/api/article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, title, sourceContext: session.sourceContext, layoutInstruction: layout.instruction }) })
      const payload = await response.json() as { html?: string; error?: string }
      if (!response.ok || !payload.html) throw new Error(payload.error || '切换排版失败')
      set({ layoutId, layoutInstruction: layout.instruction, html: payload.html, imageCandidates: {}, selectedImages: {}, uploadedImages: {} })
      setImageStep(0)
    } catch (error) { setGenerationError(error instanceof Error ? error.message : '切换排版失败') } finally { setGenerationBusy(false) }
  }
  const copyHtml = async () => { if (!html) return; await navigator.clipboard.writeText(html); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
  const download = () => { if (!html) return; const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = '公众号文章.html'; link.click(); URL.revokeObjectURL(href) }
  const restart = () => { localStorage.removeItem(storageKey); setSession(emptySession()); setGenerationError(''); setImageError(''); setImageStep(0) }
  const currentImageSlot = imageSlots[imageStep]
  const generateCurrentImages = async () => {
    if (!currentImageSlot) return
    setImageBusy(true); setImageStarted(true); setImageError('')
    try {
      const product = session.answers.product || session.idea || '文章主题'
      const research = session.sourceContext ? session.sourceContext.slice(0, 1800) : `${session.idea}；已确认内容：${JSON.stringify(facts)}`
      const titleText = activeTitle || session.idea.slice(0, 24)
      const articleContext = html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800) : ''
      const prompts = imageSlots.map(({ slot, label, ratio }) => {
        const visualRole = ratio ? '提炼主题中最吸引人的冲突、变化、情绪或核心发现，用一个强烈、易懂的视觉隐喻表现，形成前景主体与背景环境的明显反差' : `围绕文章对应段落的核心论点，设计一张信息可视化信息图（infographic），必须包含清晰可读的简体中文文字：一段 10-20 字的核心结论做主标题，2-3 个关键数据或要点做小标签。图表、流程或对比关系要用图形+文字组合表达，不是纯照片。`
        const textRule = ratio ? `画面必须加入清晰、准确、可读的简体中文主标题\u201C${titleText}\u201D，放在上方或左侧留白区，使用现代粗体排版，高对比度，不能改字、漏字或生成乱码；可加一行不超过 10 字的副标题。` : `图中的简体中文文字（主标题、数据标签、要点标签）必须清晰可读、无乱码，文字是信息的核心载体，不能去掉。`
        const contextHint = ratio ? '' : (articleContext ? `\n\n以下是已生成的文章正文（供提取对应段落论点和数据）：\n${articleContext}` : '')
        return { slot, prompt: `为微信公众号文章创作高点击率配图，先根据内容判断是产品、科普、教育、商业、生活、文化、人物、事件还是研究主题，并匹配视觉语言。主题：${product}。文章标题：${titleText}。参考内容：${research}。${visualRole}。采用与主题匹配的编辑插画或信息可视化风格，构图大胆但留白充足，主体在移动端小图中仍清晰，使用与主题气质相符的色彩，加入尺度、光线、前后对比或场景冲突来制造好奇心，避免与主题无关的实验室、芯片、网络线和泛科技背景。${textRule}不要复刻论文图表，不要 logo、水印、界面截图或无意义字母数字。${ratio ? `横版 ${ratio}` : '方形构图，信息图风格'}，适合公众号文章。${contextHint}` }
      })
      const imageCandidates: Partial<Record<CandidateSlot, string[]>> = {}
      set({ imageCandidates: {}, selectedImages: {}, uploadedImages: {} })
      const pending = Object.fromEntries(imageSlots.flatMap(({ slot }) => Array.from({ length: 4 }, (_, index) => [`${slot}-${index}`, true])))
      setImagePending(pending)
      const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: prompts, candidatesPerSlot: 4 }) })
      const reader = response.body?.getReader()
      if (!response.ok || !reader) throw new Error('候选图服务未返回流式结果，请确认本地 API 正在运行')
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        for (const line of buffer.split('\n').slice(0, -1)) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; slot?: CandidateSlot; index?: number; dataUrl?: string; error?: string }
          if (event.type === 'image' && event.slot && event.index !== undefined && event.dataUrl) {
            const candidates = [...(imageCandidates[event.slot] || [])]
            candidates[event.index] = event.dataUrl
            imageCandidates[event.slot] = candidates
            set({ imageCandidates: { ...imageCandidates } })
            setImagePending((current) => ({ ...current, [`${event.slot}-${event.index}`]: false }))
          }
          if (event.type === 'error') throw new Error(event.error || '候选图生成失败')
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
        if (done) break
      }
      setImagePending({})
    } catch (error) { setImageError(error instanceof Error ? error.message : '候选图生成失败') } finally { setImageBusy(false) }
  }
  const replacePreviewImages = (currentHtml: string, images: Partial<Record<CandidateSlot, string>>) => {
    const doc = new DOMParser().parseFromString(currentHtml, 'text/html')
    for (const [slot, src] of Object.entries(images)) {
      if (!src) continue
      const isCover = slot === 'cover'
      if (isCover) {
        const el = doc.querySelector('[data-component="cover-image"]')
        if (el) el.innerHTML = `<img src="${src}" alt="文章封面" style="display:block;width:100%;aspect-ratio:2.35/1;object-fit:cover">`
      } else {
        const index = parseInt(slot.split('-')[1]) - 1
        const elements = doc.querySelectorAll('[data-component="evidence-image"]')
        const el = elements[index]
        if (el) el.innerHTML = `<img src="${src}" alt="正文配图 ${slot}" style="display:block;width:100%;height:auto;border-radius:8px">`
      }
    }
    return doc.body.innerHTML
  }
  const selectImage = (slot: CandidateSlot, index: number) => {
    const selectedImages = { ...session.selectedImages, [slot]: index }
    const previewImages: Partial<Record<CandidateSlot, string>> = {}
    for (const { slot: s } of imageSlots) {
      const i = selectedImages[s]
      if (i !== undefined && session.imageCandidates[s]?.[i]) previewImages[s] = session.imageCandidates[s]![i]
    }
    const previewHtml = Object.keys(previewImages).length ? replacePreviewImages(html, previewImages) : html
    set({ selectedImages, uploadedImages: {}, html: previewHtml })
  }
  const confirmImageStep = () => setImageStep(imageSlots.length)
  const uploadImages = async () => {
    const selected = imageSlots.filter(({ slot }) => session.selectedImages[slot] !== undefined)
    if (!selected.length) return
    setImageBusy(true); setImageError('')
    try {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const response = await fetch('/api/upload-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: selected.map(({ slot }) => ({ key: `${slot}-${stamp}.png`, dataUrl: session.imageCandidates[slot]![session.selectedImages[slot]!] })) }) })
      const reader = response.body?.getReader()
      if (!response.ok || !reader) throw new Error('COS 上传服务未返回流式结果')
      const decoder = new TextDecoder()
      let buffer = ''
      const uploadedImages: Record<CandidateSlot, string> = {} as Record<CandidateSlot, string>
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        for (const line of buffer.split('\n').slice(0, -1)) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; key?: string; url?: string; error?: string }
          if (event.type === 'uploaded' && event.key && event.url) {
            const slot = event.key.split('-').slice(0, -2).join('-') as CandidateSlot
            uploadedImages[slot] = event.url
            set({ uploadedImages: { ...uploadedImages }, html: replaceArticleImages(html, uploadedImages) })
          }
          if (event.type === 'error') throw new Error(event.error || 'COS 上传失败')
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
        if (done) break
      }
    } catch (error) { setImageError(error instanceof Error ? error.message : 'COS 上传失败') } finally { setImageBusy(false) }
  }
  const allSelected = imageSlots.every(({ slot }) => session.selectedImages[slot] !== undefined)
  // #region debug-point cos-image-preview-events
  const reportPreviewImage = (event: 'load' | 'error', image: HTMLImageElement) => {
    void fetch('/api/debug/cos-image-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }) }).catch(() => undefined)
  }
  // #endregion debug-point cos-image-preview-events

  return <main className="workspace">
    <header className="topbar"><div><p className="eyebrow">LOCAL ARTICLE WORKFLOW</p><h1>公众号文章工作台</h1></div><div className="top-actions"><button className="reset" onClick={openSettings}><Settings size={15}/>设置</button><button className="reset" onClick={restart}><RotateCcw size={15}/>新建会话</button></div></header>{settingsOpen && <div className="settings-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><p className="label">本机配置</p><h2>服务与存储设置</h2></div><button className="icon-close" onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><X size={18}/></button></div><p className="guide">配置仅保存到本机 `.env`。密钥不会回显；留空表示保留现有密钥。</p><div className="settings-fields">{settingFields.map((field) => <label key={field.key}><span>{field.label}</span><input type={field.secret ? 'password' : 'text'} value={settings[field.key]} placeholder={field.placeholder} onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}</div>{settingsMessage && <p className={settingsMessage.startsWith('已保存') ? 'upload-success' : 'image-error'}>{settingsMessage}</p>}<button className="primary" onClick={saveSettings} disabled={settingsBusy}>{settingsBusy ? '处理中…' : '保存到 .env'}</button><button className="secondary" onClick={() => { setLayoutOpen(true); void loadLayouts() }}>管理文章排版</button></section></div>}{layoutOpen && <div className="settings-backdrop" onMouseDown={() => setLayoutOpen(false)}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><p className="label">AI 排版库</p><h2>添加或管理排版</h2></div><button className="icon-close" onClick={() => setLayoutOpen(false)} aria-label="关闭排版"><X size={18}/></button></div><p className="guide">粘贴参考文章链接，AI 会吸收它的视觉层级与排版规律，不会复制原文内容。</p><div className="link-extract"><input value={layoutUrl} onChange={(event) => setLayoutUrl(event.target.value)} placeholder="https://参考文章链接" /><button className="secondary" onClick={absorbLayout} disabled={!layoutUrl.trim() || layoutBusy}>{layoutBusy ? 'AI 吸收中…' : 'AI 添加排版'}</button></div>{layoutMessage && <p className="guide">{layoutMessage}</p>}<div className="title-list">{layouts.map((layout) => <div className="section-check" key={layout.id}><span><b>{layout.name}</b><br/>{layout.description}</span>{!layout.builtin && <button className="reset" onClick={() => deleteLayout(layout.id)}>删除</button>}</div>)}</div></section></div>}
    <div className="progress">{stageLabels.map((label, index) => <span className={index <= stageOrder[session.stage] ? 'active' : ''} key={label}>{index + 1}. {label}</span>)}</div>
    <section className="layout"><aside className="controls">
      {session.stage === 'idea' && <section className="panel"><div className="panel-head"><div><p className="label">开始创作</p><h2>先说一句想法</h2></div><Sparkles size={20}/></div><p className="guide">可以手动输入，或粘贴公开文章/产品链接，让 AI 提炼一句想法后再修改。</p><div className="link-extract"><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="粘贴公开网页链接（https://...）" /><button className="secondary" onClick={extractIdea} disabled={!sourceUrl.trim() || extractBusy}>{extractBusy ? 'AI 正在提炼…' : '从链接提炼想法'}</button></div>{extractError && <p className="image-error">{extractError}</p>}<textarea value={session.idea} onChange={(event) => set({ idea: event.target.value })} placeholder="用一句话描述你的产品想法" />{session.sourceContext && <><p className="guide">链接参考内容（可修改；会关联到后续全部 AI 生成）：</p><textarea className="source-context" value={session.sourceContext} onChange={(event) => set({ sourceContext: event.target.value })} placeholder="链接提取的参考内容" /></>}<button className="primary" onClick={startQuestions}>开始逐题确认</button></section>}
      {session.stage === 'questions' && <section className="panel"><p className="label">逐题确认 · {Math.max(1, questionIndex + 1)} / 7</p><h2>{currentQuestion.label}</h2><p className="guide">{currentQuestion.hint}</p>{confirmedContext.length > 0 && <section className="question-context"><strong>已确认内容会联动到本题</strong>{confirmedContext.map((item) => <p key={item.label}><b>{item.label}</b>{item.value}</p>)}</section>}<button className="secondary" onClick={generateQuestionOptions} disabled={questionBusy}>{questionBusy ? 'AI 正在基于链接与已确认内容生成建议…' : '重新生成 4 个关联建议'}</button>{questionError && <p className="image-error">{questionError}</p>}{questionOptions.length === 4 && <div className="title-list question-options">{questionOptions.map((option, index) => <button key={option} onClick={() => { setCustomAnswer(option); saveAnswer(option) }}><b>AI 方案 {index + 1}</b>{option}</button>)}</div>}<p className="guide">{session.sourceContext ? '已自动填入第一条关联建议，可直接修改：' : '也可以不选建议，直接填写自定义内容：'}</p><textarea key={currentQuestion.key} autoFocus value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="输入你的自定义确认信息" onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveAnswer(event.currentTarget.value) }} /><button className="primary" onClick={() => saveAnswer(customAnswer)}>使用当前内容，下一题</button><small className="shortcut">可按 Ctrl / ⌘ + Enter 提交</small></section>}
      {session.stage === 'titles' && <section className="panel"><p className="label">标题三选一</p><label><span className="label">文章排版</span><select value={session.layoutId} onChange={(event) => { const layout = layouts.find((item) => item.id === event.target.value); set({ layoutId: event.target.value, layoutInstruction: layout?.instruction || '' }) }}>{layouts.map((layout) => <option value={layout.id} key={layout.id}>{layout.name}</option>)}</select></label><h2>选定文章标题</h2><p className="guide">标题已结合确认事实与{session.sourceContext ? '链接提取的文章/论文内容' : '当前确认内容'}生成；不满意可重新推荐。</p>{generationError && <p className="image-error">{generationError}</p>}<div className="title-list">{titles.map((title, index) => <button disabled={generationBusy} className={session.selectedTitle === index ? 'selected' : ''} onClick={() => chooseTitle(index)} key={title}><b>方案 {index + 1}</b>{title}</button>)}</div><label><span className="label">自定义标题</span><input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="输入你想使用的文章标题" /></label><button className="secondary" onClick={chooseCustomTitle} disabled={generationBusy || !customTitle.trim()}>{generationBusy ? '正在生成文章…' : '使用自定义标题'}</button><button className="secondary" onClick={() => void generateTitles()} disabled={generationBusy}>{generationBusy ? '正在重新推荐…' : '重新推荐 3 个标题'}</button>{generationError && <p className="image-error">{generationError}</p>}{generationBusy && <p className="guide">正在生成 AI 文章…</p>}</section>}
      {session.stage === 'editor' && <><section className="panel"><p className="label">候选图片 · {Math.min(imageStep + 1, 4)} / 4</p><h2>{imageStep < 4 ? `选择${currentImageSlot.label}` : '4 张图片已选定'}</h2>{imageStep < 4 && <><p className="guide">当前仅生成 {currentImageSlot.label} 的 4 张候选图。选定一张后，才会进入下一图位。</p><button className="primary" onClick={generateCurrentImages} disabled={imageBusy}>{imageBusy ? '处理中…' : `生成 ${currentImageSlot.label} 4 张候选图`}</button>{imageError && <p className="image-error">{imageError}</p>}{(imageStarted || Object.keys(session.imageCandidates).length > 0) && <div className="image-candidate-groups">{imageSlots.map(({ slot, label, ratio }) => <div className="candidate-slot" key={slot}><strong>{label}<em>{ratio || '1:1'}</em></strong><div className={`candidate-grid ${ratio ? 'cover-grid' : ''}`}>{Array.from({ length: 4 }, (_, index) => { const source = session.imageCandidates[slot]?.[index]; const pending = imagePending[`${slot}-${index}`]; return source ? <button className={session.selectedImages[slot] === index ? 'chosen' : ''} onClick={() => selectImage(slot, index)} key={source}><img src={source} alt={`${label} 候选 ${index + 1}`} /></button> : <div className="image-placeholder" key={`${slot}-${index}`}><span className="image-spinner" />{pending ? '生成中…' : '等待生成'}</div> })}</div></div>)}</div>}{Object.keys(session.selectedImages).length > 0 && <button className="primary" onClick={confirmImageStep}>确认已选图片，进入上传</button>}</>}{imageStep === 4 && <><p className="guide">封面与 3 张正文图均已选定。确认上传后，会自动写入最终 HTML。</p><button className="primary" onClick={uploadImages} disabled={imageBusy}>{imageBusy ? `上传中 ${Object.keys(session.uploadedImages).length}/4…` : '确认 4 张并上传 COS'}</button>{imageError && <p className="image-error">{imageError}</p>}{Object.keys(session.uploadedImages).length === 4 && <p className="upload-success">已替换为 COS 公共 HTTPS 图片链接，可直接复制文章。</p>}</>}</section><section className="panel"><p className="label">最终 HTML</p><h2>编辑、复制或下载</h2><textarea className="html-editor" value={html} onChange={(event) => set({ html: event.target.value })} /><div className="editor-actions"><button onClick={copyHtml}><Clipboard size={15}/>{copied ? '已复制' : '复制 HTML'}</button><button onClick={download}><FileDown size={15}/>下载 HTML</button></div></section></>}
      <section className="panel session-note"><FileText size={18}/><div><strong>本地会话已自动保存</strong><span>关闭页面后可从当前步骤继续。</span></div></section>
    </aside><section className="preview-shell"><div className="preview-toolbar"><div><span className="label">文章预览 · 可切换排版</span><select value={session.layoutId} onChange={(event) => void changeLayout(event.target.value)} disabled={generationBusy || !html}>{layouts.map((layout) => <option value={layout.id} key={layout.id}>{layout.name}</option>)}</select><strong>{activeTitle || '完成确认后生成文章'}</strong></div><div className="toolbar-actions"><button disabled={!html} onClick={copyHtml}><Clipboard size={15}/>{copied ? '已复制' : '复制 HTML'}</button><button disabled={!html} onClick={download}><FileDown size={15}/>下载</button></div></div><div className="phone-stage">{html ? <article key={session.selectedImages ? Object.values(session.selectedImages).join(',') + Object.values(session.uploadedImages).join(',') : ''} className="article-preview" contentEditable suppressContentEditableWarning onBlur={(event) => set({ html: event.currentTarget.innerHTML })} dangerouslySetInnerHTML={{ __html: html }} /> : <div className="empty-preview"><PenLine size={28}/><p>完成标题选择后，这里将显示文章预览。</p></div>}</div></section></section>
  </main>
}
