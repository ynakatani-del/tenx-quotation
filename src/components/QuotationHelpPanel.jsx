import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, FileText, List, Printer, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { parseQuotationGuide, parseQuotationHandover } from '../lib/quotationHelpAccess'

const linkStyle = 'rounded text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900'

const guideShortcuts = [
  ['create', FileText, '見積を作る', '入力・下書き保存・承認申請'],
  ['prices', List, '単価を確認・更新する', '登録単価の確認・新規登録・更新'],
  ['print', Printer, '承認後のPDFを出す', '宛先・明細・合計を確認して出力'],
]

function GuideWelcome({ current, topics, heading, onSelect }) {
  return (
    <>
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-5 sm:px-5">
        <p className="text-xs font-semibold tracking-wider text-blue-700">はじめに</p>
        <h3 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">スピードこそ戦略</h3>
        <p className="mt-2 text-sm text-gray-700">誰が作っても、速く、品質のそろった見積もりを。</p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">やりたいことから選ぶ</h4>
        {guideShortcuts.filter(([id]) => Object.hasOwn(topics, id)).map(([id, Icon, label, description]) => (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-labelledby={`quotation-guide-label-${id}`} aria-describedby={`quotation-guide-description-${id}`}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-blue-300 hover:bg-blue-50">
            <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><Icon size={17} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span id={`quotation-guide-label-${id}`} className="block font-semibold text-gray-900">{label}</span>
              <span id={`quotation-guide-description-${id}`} className="block text-xs text-gray-600">{description}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-blue-700" aria-hidden="true" />
          </button>
        ))}
      </div>
      <details className="rounded-lg border border-gray-200 px-3">
        <summary className="cursor-pointer py-3 font-medium text-gray-800">このアプリを作った理由・最初に確認すること</summary>
        <div className="space-y-3 pb-3">
          {current.intro && <p>{current.intro}</p>}
          {current.steps.map(step => <p key={step}>{step}</p>)}
        </div>
      </details>
    </>
  )
}

function Guide({ document, initialTopic, bodyRef }) {
  const { checkedOn, features, releases, topics } = document
  const [view, setView] = useState('guide')
  const [topic, setTopic] = useState(Object.hasOwn(topics, initialTopic) ? initialTopic : 'start')
  const heading = useRef(null)
  const focusNextHeading = useRef(false)
  const current = topics[topic]
  const isWelcome = view === 'guide' && topic === 'start'

  useEffect(() => {
    if (!focusNextHeading.current) return
    focusNextHeading.current = false
    heading.current?.focus({ preventScroll: true })
  }, [view, topic])

  function show(nextView, nextTopic = topic) {
    if (nextView !== view || nextTopic !== topic) focusNextHeading.current = true
    setView(nextView)
    setTopic(nextTopic)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }

  function topicLink(id) {
    return <button key={id} type="button" className={linkStyle} onClick={() => show('guide', id)}>{topics[id].title}</button>
  }

  return (
    <>
      <div role="group" aria-label="ガイドの区分" className="flex flex-wrap gap-2">
        {[['guide', '使い方ガイド'], ['features', '機能一覧'], ['releases', '更新履歴']].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={view === id} onClick={() => show(id)}
            className={`rounded-lg border px-3 py-2 text-sm ${view === id ? 'border-blue-200 bg-blue-50 font-semibold text-blue-800' : 'border-gray-200 text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">現行機能の確認日: <time dateTime={checkedOn}>{checkedOn}</time></p>
      {isWelcome ? (
        <GuideWelcome current={current} topics={topics} heading={heading} onSelect={id => show('guide', id)} />
      ) : (
        <>
          {view === 'guide' && (
            <button type="button" onClick={() => show('guide', 'start')} className={`inline-flex items-center gap-1 ${linkStyle}`}>
              <ArrowLeft size={15} aria-hidden="true" /> はじめに戻る
            </button>
          )}
          <h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-gray-900">
            {view === 'guide' ? current.title : view === 'features' ? '機能一覧' : '更新履歴'}
          </h3>
        </>
      )}
      {view === 'guide' && (
        <>
          {!isWelcome && (
            <>
              {current.intro && <p>{current.intro}</p>}
              <ol className="list-decimal space-y-2 pl-5">{current.steps.map(step => <li key={step}>{step}</li>)}</ol>
              {current.related.length > 0 && (
                <div className="flex flex-col items-start gap-2">
                  <h4 className="font-semibold">関連ガイド</h4>
                  {current.related.map(topicLink)}
                </div>
              )}
            </>
          )}
          <label className="block">
            <span className="mb-1 block font-semibold">別の項目を開く</span>
            <select value={topic} onChange={event => show('guide', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white p-2">
              {Object.entries(topics).map(([id, entry]) => <option key={id} value={id}>{entry.title}</option>)}
            </select>
          </label>
        </>
      )}
      {view === 'features' && features.map(([name, use, who, where, note, id]) => (
        <section key={name} className="rounded-lg border border-gray-200 p-3">
          <h4 className="font-semibold text-gray-900">{name}</h4>
          <p>{use}</p>
          <dl className="my-2 space-y-1">
            {[[ '利用者', who ], [ '場所', where ], [ '注意点', note ]].map(([label, value]) => (
              <div key={label} className="flex gap-2"><dt className="shrink-0 font-medium">{label}:</dt><dd>{value}</dd></div>
            ))}
          </dl>
          {topicLink(id)}
        </section>
      ))}
      {view === 'releases' && releases.map(entry => (
        <section key={entry.date} className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">公開日: <time dateTime={entry.date}>{entry.date}</time></p>
          <h4 className="font-semibold text-gray-900">{entry.title}</h4>
          <p>影響: {entry.impact}</p>
          <p>必要な操作: {entry.action}</p>
          {topicLink(entry.topic)}
        </section>
      ))}
    </>
  )
}

function HelpContent({ isHandover, topic, bodyRef }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const { data, error } = await supabase.functions.invoke('read-quotation-help', {
          body: { kind: isHandover ? 'handover' : 'guide' },
          signal: controller.signal,
        })
        if (error || !data) throw error || new Error('Help content unavailable')
        const parse = isHandover ? parseQuotationHandover : parseQuotationGuide
        const document = parse(data)
        if (!controller.signal.aborted) setResult({ document })
      } catch {
        if (!controller.signal.aborted) setResult({ unavailable: true })
      }
    }
    load()
    return () => controller.abort()
  }, [attempt, isHandover])

  if (!result) return <p role="status">資料を読み込んでいます…</p>
  if (result.unavailable) return (
    <div role="alert" className="space-y-2">
      <p>{isHandover ? '設計・引き継ぎ資料' : '使い方ガイド'}を取得できません。閲覧権限または資料の保管状態を運用担当者に確認してください。</p>
      <button type="button" className={linkStyle} onClick={() => { setResult(null); setAttempt(attempt + 1) }}>再試行</button>
    </div>
  )
  const { document } = result
  if (!isHandover) return <Guide document={document} initialTopic={topic} bodyRef={bodyRef} />
  return (
    <>
      <p className="text-xs text-gray-500">特権管理者限定・更新日: <time dateTime={document.updatedOn}>{document.updatedOn}</time></p>
      {document.sections.map(({ title, paragraphs }, index) => (
        <section key={index} className="space-y-2 rounded-lg border border-gray-200 p-3">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          {paragraphs.map((paragraph, i) => <p key={i} className="whitespace-pre-wrap break-words">{paragraph}</p>)}
        </section>
      ))}
    </>
  )
}

export default function QuotationHelpPanel({ kind, topic, onClose }) {
  const dialog = useRef(null)
  const body = useRef(null)
  const closeButton = useRef(null)
  const isHandover = kind === 'handover'
  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal()
    closeButton.current.focus()
  }, [])

  return (
    <dialog ref={dialog} aria-labelledby="quotation-help-title" onClose={onClose}
      className="no-print fixed inset-y-0 left-auto right-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-white p-0 text-gray-700 shadow-xl backdrop:bg-black/30 md:w-[34rem]">
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 id="quotation-help-title" className="text-lg font-semibold text-gray-900">{isHandover ? '設計・引き継ぎ' : '使い方ガイド'}</h2>
          <button ref={closeButton} type="button" onClick={() => dialog.current.close()}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <X size={16} aria-hidden="true" /> 閉じる
          </button>
        </header>
        <div ref={body} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 text-sm leading-relaxed md:px-6">
          <HelpContent isHandover={isHandover} topic={topic} bodyRef={body} />
        </div>
      </div>
    </dialog>
  )
}
