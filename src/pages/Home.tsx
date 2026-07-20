import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Clipboard, FileDown, FileText, PenLine, RotateCcw, Settings, Sparkles, X } from 'lucide-react'
import { replaceArticleImages } from '@/lib/articleIntegrity'
import { emptySession, factsFor, questions, restoreSession, sectionNames, storageKey, type CandidateSlot, type WorkflowSession } from '@/lib/workflow'

const stageLabels = ['一句想法', '逐题追问', '事实确认', '标题三选一', '逐段确认', '完成编辑']
type AppSettings = Record<'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'ARTICLE_MODEL' | 'IMAGE_MODEL' | 'COS_SECRET_ID' | 'COS_SECRET_KEY' | 'COS_BUCKET' | 'COS_REGION' | 'COS_KEY_PREFIX', string>
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
  const [questionOptions, setQuestionOptions] = useState<string[]>([])
  const [questionBusy, setQuestionBusy] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [customAnswer, setCustomAnswer] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState('')
  const [imageStep, setImageStep] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(emptySettings)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const facts = useMemo(() => factsFor(session), [session])
  const titles = session.generatedTitles
  const html = session.html
  const questionIndex = questions.findIndex((question) => !session.answers[question.key])
  const currentQuestion = questions[Math.max(0, questionIndex)]
  const confirmedContext = questions.slice(0, Math.max(0, questionIndex)).map((question) => ({ label: question.label, value: session.answers[question.key] })).filter((item) => item.value)
  const set = (update: Partial<WorkflowSession>) => setSession((current) => ({ ...current, ...update }))

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(session)) }, [session])

  const openSettings = async () => {
    setSettingsOpen(true); setSettingsBusy(true); setSettingsMessage('')
    try {
      const response = await fetch('/api/settings')
      const payload = await response.json() as { settings?: AppSettings; error?: string }
      if (!response.ok || !payload.settings) throw new Error(payload.error || '读取设置失败')
      setSettings({ ...emptySettings, ...payload.settings })
    } catch (error) { setSettingsMessage(error instanceof Error ? error.message : '读取设置失败') } finally { setSettingsBusy(false) }
  }
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
    set({ answers, stage: questions.every((question) => answers[question.key]) ? 'facts' : 'questions' })
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

  const toggleFact = (index: number) => { const factsConfirmed = [...session.factsConfirmed]; factsConfirmed[index] = !factsConfirmed[index]; set({ factsConfirmed }) }
  const generateTitles = async () => {
    setGenerationBusy(true); setGenerationError('')
    try {
      const response = await fetch('/api/titles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, sourceContext: session.sourceContext }) })
      const payload = await response.json() as { titles?: string[]; error?: string }
      if (!response.ok || !Array.isArray(payload.titles) || payload.titles.length !== 3) throw new Error(payload.error || '标题生成失败')
      set({ generatedTitles: payload.titles, stage: 'titles' })
    } catch (error) { setGenerationError(error instanceof Error ? error.message : '标题生成失败') } finally { setGenerationBusy(false) }
  }
  const chooseTitle = async (index: number) => {
    const title = titles[index]
    if (!title) return
    setGenerationBusy(true); setGenerationError('')
    try {
      const response = await fetch('/api/article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, title, sourceContext: session.sourceContext }) })
      const payload = await response.json() as { html?: string; error?: string }
      if (!response.ok || !payload.html) throw new Error(payload.error || '文章生成失败')
      set({ selectedTitle: index, stage: 'sections', sectionIndex: 0, confirmedSections: Array(4).fill(false), html: payload.html, imageCandidates: {}, selectedImages: {}, uploadedImages: {} })
    } catch (error) { setGenerationError(error instanceof Error ? error.message : '文章生成失败') } finally { setGenerationBusy(false) }
  }
  const confirmSection = () => {
    const confirmedSections = [...session.confirmedSections]
    confirmedSections[session.sectionIndex] = true
    const next = session.sectionIndex + 1
    set({ confirmedSections, sectionIndex: next, stage: next === sectionNames.length ? 'editor' : 'sections' })
  }
  const copyHtml = async () => { if (!html) return; await navigator.clipboard.writeText(html); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
  const download = () => { if (!html) return; const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = '公众号文章.html'; link.click(); URL.revokeObjectURL(href) }
  const restart = () => { localStorage.removeItem(storageKey); setSession(emptySession()); setGenerationError(''); setImageError(''); setImageStep(0) }
  const currentImageSlot = imageSlots[imageStep]
  const generateCurrentImages = async () => {
    if (!currentImageSlot) return
    setImageBusy(true); setImageError('')
    try {
      const product = session.answers.product || '产品'
      const context = session.sourceContext ? `；参考内容：${session.sourceContext.slice(0, 600)}` : ''
      const { slot, label, ratio } = currentImageSlot
      const prompt = ratio ? `微信公众号文章横版封面，主题：${product}${context}，绿色科技风格，清晰简洁，无文字，适合 ${ratio} 展示` : `微信公众号文章 ${label}，主题：${product}${context}，绿色科技风格，产品证据视觉，无文字`
      const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: [{ slot, prompt }], candidatesPerSlot: 4 }) })
      const raw = await response.text()
      let payload: { images?: Array<{ slot: CandidateSlot; candidates: string[] }>; error?: string }
      try { payload = JSON.parse(raw) as typeof payload } catch { throw new Error(`候选图服务未返回 JSON（HTTP ${response.status}），请确认本地 API 正在运行`) }
      const candidates = payload.images?.[0]?.candidates
      if (!response.ok || !candidates || candidates.length !== 4) throw new Error(payload.error || '候选图生成失败')
      set({ imageCandidates: { ...session.imageCandidates, [slot]: candidates }, selectedImages: { ...session.selectedImages, [slot]: undefined }, uploadedImages: {} })
    } catch (error) { setImageError(error instanceof Error ? error.message : '候选图生成失败') } finally { setImageBusy(false) }
  }
  const selectImage = (slot: CandidateSlot, index: number) => set({ selectedImages: { ...session.selectedImages, [slot]: index }, uploadedImages: {} })
  const confirmImageStep = () => { if (currentImageSlot && session.selectedImages[currentImageSlot.slot] !== undefined) setImageStep((step) => Math.min(step + 1, imageSlots.length)) }
  const uploadImages = async () => {
    if (!imageSlots.every(({ slot }) => session.selectedImages[slot] !== undefined)) return
    setImageBusy(true); setImageError('')
    try {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const response = await fetch('/api/upload-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: imageSlots.map(({ slot }) => ({ key: `${slot}-${stamp}.png`, dataUrl: session.imageCandidates[slot]![session.selectedImages[slot]!] })) }) })
      const payload = await response.json() as { images?: Array<{ key: string; url: string }>; error?: string }
      if (!response.ok || !payload.images) throw new Error(payload.error || 'COS 上传失败')
      const uploadedImages = Object.fromEntries(payload.images.map((item) => [item.key.split('-').slice(0, -2).join('-') as CandidateSlot, item.url])) as Record<CandidateSlot, string>
      set({ uploadedImages, html: replaceArticleImages(html, uploadedImages) })
    } catch (error) { setImageError(error instanceof Error ? error.message : 'COS 上传失败') } finally { setImageBusy(false) }
  }
  const allSelected = imageSlots.every(({ slot }) => session.selectedImages[slot] !== undefined)

  return <main className="workspace">
    <header className="topbar"><div><p className="eyebrow">LOCAL ARTICLE WORKFLOW</p><h1>公众号文章工作台</h1></div><div className="top-actions"><button className="reset" onClick={openSettings}><Settings size={15}/>设置</button><button className="reset" onClick={restart}><RotateCcw size={15}/>新建会话</button></div></header>{settingsOpen && <div className="settings-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><p className="label">本机配置</p><h2>服务与存储设置</h2></div><button className="icon-close" onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><X size={18}/></button></div><p className="guide">配置仅保存到本机 `.env`。密钥不会回显；留空表示保留现有密钥。</p><div className="settings-fields">{settingFields.map((field) => <label key={field.key}><span>{field.label}</span><input type={field.secret ? 'password' : 'text'} value={settings[field.key]} placeholder={field.placeholder} onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}</div>{settingsMessage && <p className={settingsMessage.startsWith('已保存') ? 'upload-success' : 'image-error'}>{settingsMessage}</p>}<button className="primary" onClick={saveSettings} disabled={settingsBusy}>{settingsBusy ? '处理中…' : '保存到 .env'}</button></section></div>}
    <div className="progress">{stageLabels.map((label, index) => <span className={index <= ['idea', 'questions', 'facts', 'titles', 'sections', 'editor'].indexOf(session.stage) ? 'active' : ''} key={label}>{index + 1}. {label}</span>)}</div>
    <section className="layout"><aside className="controls">
      {session.stage === 'idea' && <section className="panel"><div className="panel-head"><div><p className="label">开始创作</p><h2>先说一句想法</h2></div><Sparkles size={20}/></div><p className="guide">可以手动输入，或粘贴公开文章/产品链接，让 AI 提炼一句想法后再修改。</p><div className="link-extract"><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="粘贴公开网页链接（https://...）" /><button className="secondary" onClick={extractIdea} disabled={!sourceUrl.trim() || extractBusy}>{extractBusy ? 'AI 正在提炼…' : '从链接提炼想法'}</button></div>{extractError && <p className="image-error">{extractError}</p>}<textarea value={session.idea} onChange={(event) => set({ idea: event.target.value })} placeholder="用一句话描述你的产品想法" />{session.sourceContext && <><p className="guide">链接参考内容（可修改；会关联到后续全部 AI 生成）：</p><textarea className="source-context" value={session.sourceContext} onChange={(event) => set({ sourceContext: event.target.value })} placeholder="链接提取的参考内容" /></>}<button className="primary" onClick={startQuestions}>开始逐题确认</button></section>}
      {session.stage === 'questions' && <section className="panel"><p className="label">逐题确认 · {Math.max(1, questionIndex + 1)} / 7</p><h2>{currentQuestion.label}</h2><p className="guide">{currentQuestion.hint}</p>{confirmedContext.length > 0 && <section className="question-context"><strong>已确认内容会联动到本题</strong>{confirmedContext.map((item) => <p key={item.label}><b>{item.label}</b>{item.value}</p>)}</section>}<button className="secondary" onClick={generateQuestionOptions} disabled={questionBusy}>{questionBusy ? 'AI 正在基于链接与已确认内容生成建议…' : '重新生成 4 个关联建议'}</button>{questionError && <p className="image-error">{questionError}</p>}{questionOptions.length === 4 && <div className="title-list question-options">{questionOptions.map((option, index) => <button key={option} onClick={() => { setCustomAnswer(option); saveAnswer(option) }}><b>AI 方案 {index + 1}</b>{option}</button>)}</div>}<p className="guide">{session.sourceContext ? '已自动填入第一条关联建议，可直接修改：' : '也可以不选建议，直接填写自定义内容：'}</p><textarea key={currentQuestion.key} autoFocus value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="输入你的自定义确认信息" onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveAnswer(event.currentTarget.value) }} /><button className="primary" onClick={() => saveAnswer(customAnswer)}>使用当前内容，下一题</button><small className="shortcut">可按 Ctrl / ⌘ + Enter 提交</small></section>}
      {session.stage === 'facts' && <section className="panel"><p className="label">事实卡确认</p><h2>逐项核对写作事实</h2><div className="fact-list">{Object.entries(facts).map(([name, value], index) => <label key={name}><input type="checkbox" checked={session.factsConfirmed[index]} onChange={() => toggleFact(index)} /><span><strong>{name}</strong>{value}</span></label>)}</div>{generationError && <p className="image-error">{generationError}</p>}<button className="primary" disabled={!session.factsConfirmed.every(Boolean) || generationBusy} onClick={generateTitles}>{generationBusy ? '正在生成 AI 标题…' : '事实无误，生成 AI 标题'}</button></section>}
      {session.stage === 'titles' && <section className="panel"><p className="label">标题三选一</p><h2>选定文章标题</h2>{generationError && <p className="image-error">{generationError}</p>}<div className="title-list">{titles.map((title, index) => <button disabled={generationBusy} className={session.selectedTitle === index ? 'selected' : ''} onClick={() => chooseTitle(index)} key={title}><b>方案 {index + 1}</b>{title}</button>)}</div>{generationBusy && <p className="guide">正在生成 AI 文章…</p>}</section>}
      {session.stage === 'sections' && <section className="panel"><p className="label">逐段确认 · {session.sectionIndex + 1} / 4</p><h2>{sectionNames[session.sectionIndex]}</h2><p className="guide">请在右侧预览已生成的文章。确认后将继续下一段，完成后可编辑最终 HTML。</p><div className="section-check"><CheckCircle2 size={20}/><span>标题已选定：{titles[session.selectedTitle ?? 0]}</span></div><button className="primary" onClick={confirmSection}><Check size={16}/>确认这一段</button></section>}
      {session.stage === 'editor' && <><section className="panel"><p className="label">候选图片 · {Math.min(imageStep + 1, 4)} / 4</p><h2>{imageStep < 4 ? `选择${currentImageSlot.label}` : '4 张图片已选定'}</h2>{imageStep < 4 && <><p className="guide">当前仅生成 {currentImageSlot.label} 的 4 张候选图。选定一张后，才会进入下一图位。</p><button className="primary" onClick={generateCurrentImages} disabled={imageBusy}>{imageBusy ? '处理中…' : `生成 ${currentImageSlot.label} 4 张候选图`}</button>{imageError && <p className="image-error">{imageError}</p>}{session.imageCandidates[currentImageSlot.slot] && <div className={`candidate-grid ${currentImageSlot.slot === 'cover' ? 'cover-grid' : ''}`}>{session.imageCandidates[currentImageSlot.slot]!.map((source, index) => <button className={session.selectedImages[currentImageSlot.slot] === index ? 'chosen' : ''} onClick={() => selectImage(currentImageSlot.slot, index)} key={source}><img src={source} alt={`${currentImageSlot.label} 候选 ${index + 1}`} /></button>)}</div>}{session.selectedImages[currentImageSlot.slot] !== undefined && <button className="primary" onClick={confirmImageStep}>确认这张，{imageStep === 3 ? '进入上传' : '生成下一图位'}</button>}</>}{imageStep === 4 && <><p className="guide">封面与 3 张正文图均已选定。确认上传后，会自动写入最终 HTML。</p><button className="primary" onClick={uploadImages} disabled={imageBusy}>{imageBusy ? '上传中…' : '确认 4 张并上传 COS'}</button>{imageError && <p className="image-error">{imageError}</p>}{Object.keys(session.uploadedImages).length === 4 && <p className="upload-success">已替换为 COS 公共 HTTPS 图片链接，可直接复制文章。</p>}</>}</section><section className="panel"><p className="label">最终 HTML</p><h2>编辑、复制或下载</h2><textarea className="html-editor" value={html} onChange={(event) => set({ html: event.target.value })} /><div className="editor-actions"><button onClick={copyHtml}><Clipboard size={15}/>{copied ? '已复制' : '复制 HTML'}</button><button onClick={download}><FileDown size={15}/>下载 HTML</button></div></section></>}
      <section className="panel session-note"><FileText size={18}/><div><strong>本地会话已自动保存</strong><span>关闭页面后可从当前步骤继续。</span></div></section>
    </aside><section className="preview-shell"><div className="preview-toolbar"><div><span className="label">固定绿色科技文章预览</span><strong>{session.selectedTitle !== null ? titles[session.selectedTitle] : '完成确认后生成文章'}</strong></div><div className="toolbar-actions"><button disabled={!html} onClick={copyHtml}><Clipboard size={15}/>{copied ? '已复制' : '复制 HTML'}</button><button disabled={!html} onClick={download}><FileDown size={15}/>下载</button></div></div><div className="phone-stage">{html ? <article className="article-preview" contentEditable suppressContentEditableWarning onBlur={(event) => set({ html: event.currentTarget.innerHTML })} dangerouslySetInnerHTML={{ __html: html }} /> : <div className="empty-preview"><PenLine size={28}/><p>完成标题选择后，这里将显示文章预览。</p></div>}</div></section></section>
  </main>
}
