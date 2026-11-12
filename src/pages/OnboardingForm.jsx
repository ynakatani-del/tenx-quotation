import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, Save, Send, CheckCircle, Upload, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'onboarding_form_draft'

function getInitialState() {
  const today = new Date().toISOString().split('T')[0]
  return {
    lastName: '', firstName: '', lastNameKana: '', firstNameKana: '',
    employmentDate: today, birthDate: '1990-01-01', gender: 'male',
    hasSpouse: 'no', widowStatus: 'none', hasDisability: 'no', isWorkingStudent: 'no',
    registeredPostalCode: '', registeredAddress: '', registeredAddressDetail: '',
    sameAddress: true,
    currentPostalCode: '', currentAddress: '', currentAddressDetail: '',
    householdHead: '', householdRelationship: '',
    hasFamilyMembers: 'no', familyMembers: [],
    phoneNumber: '', email: '', emailConfirm: '',
    employmentInsuranceNumber: '', employmentInsuranceLater: false,
    myNumber: '', spouseMyNumber: '',
    spouseName: '', spouseNameKana: '', spouseBirthDate: '', spouseGender: '', spouseOccupation: '', spouseDependent: '',
    basicPensionNumber: '', basicPensionLater: false,
    bankName: 'ドコモSMTBネット銀行', bankBranchName: '', bankAccountType: 'ordinary',
    bankAccountNumber: '', bankAccountHolder: '',
    emergencyContacts: [
      { relationship: '', name: '', nameKana: '', address: '', phone: '', email: '' },
      { relationship: '', name: '', nameKana: '', address: '', phone: '', email: '' },
      { relationship: '', name: '', nameKana: '', address: '', phone: '', email: '' },
    ],
    hasCommuting: 'no', commutingDestinationName: '', commutingDestinationAddress: '',
    commutingLegs: [],
    healthCertFileName: '', healthCertLater: false, profilePhotoFileName: '',
    freeeSignNoticeAcknowledged: false,
  }
}

// ── コンポーネント群 ─────────────────────────────────────

function DQField({ label, required, hint, children }) {
  return (
    <div>
      <label className="dq-label">
        {label}{required && <span className="dq-required">＊</span>}
      </label>
      {children}
      {hint && <p className="dq-hint">▷ {hint}</p>}
    </div>
  )
}

function DQRadio({ value, current, onChange, label }) {
  const selected = current === value
  return (
    <div className={`dq-cursor-item ${selected ? 'selected' : ''}`} onClick={() => onChange(value)}>
      <span style={{ minWidth: '1em', color: selected ? '#f8d800' : 'transparent', fontFamily: 'DotGothic16, monospace' }}>▶</span>
      <span>{label}</span>
    </div>
  )
}

function DQRadioGroup({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-x-4" style={{ marginTop: '0.25rem' }}>
      {options.map(opt => (
        <DQRadio key={opt.value} value={opt.value} current={value} onChange={onChange} label={opt.label} />
      ))}
    </div>
  )
}

function DQInput({ value, onChange, placeholder, type = 'text', maxLength, disabled, required, className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      required={required}
      className={`dq-input w-full px-3 py-2 text-sm ${className}`}
    />
  )
}

function DQSection({ icon, title, children }) {
  return (
    <div className="dq-window p-5 mb-6">
      <div className="dq-section-title">
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

function DQSubSection({ title, children }) {
  return (
    <div className="mb-5">
      <p style={{ fontFamily: 'DotGothic16, monospace', color: '#8080ff', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
        ── {title} ──
      </p>
      {children}
    </div>
  )
}

function DQSearchButton({ onClick, loading, label = '住所検索' }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="dq-btn-ghost px-3 py-2 text-sm whitespace-nowrap">
      {loading ? '検索中…' : `▷ ${label}`}
    </button>
  )
}

const isValidEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim())

// 確認メール送信（GAS）。送信IDだけを渡し、本文はGAS側がDBから組み立てる
const MAIL_URL = import.meta.env.VITE_ONBOARDING_MAIL_URL
async function requestConfirmationMail(id) {
  if (!MAIL_URL) return { status: 'disabled' }
  const res = await fetch(MAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // プリフライト回避
    body: JSON.stringify({ id }),
  })
  return await res.json()
}

function calcProgress(data) {
  const checks = [
    !!data.lastName, !!data.firstName, !!data.lastNameKana, !!data.firstNameKana,
    !!data.employmentDate, !!data.birthDate,
    !!data.registeredPostalCode, !!data.registeredAddress,
    !!data.householdHead,
    data.hasSpouse !== 'yes' || !!(data.spouseName && data.spouseNameKana && data.spouseBirthDate && data.spouseGender && data.spouseOccupation && data.spouseDependent),
    data.hasFamilyMembers !== 'yes' || (data.familyMembers.length > 0 && data.familyMembers.every(m => m.name && m.nameKana && m.relationship && m.birthDate && m.gender)),
    !!data.phoneNumber,
    isValidEmail(data.email) && data.email === data.emailConfirm,
    !!data.myNumber,
    !!(data.employmentInsuranceNumber || data.employmentInsuranceLater),
    !!(data.basicPensionNumber || data.basicPensionLater),
    !!data.bankBranchName, !!data.bankAccountNumber, !!data.bankAccountHolder,
    !!(data.emergencyContacts[0]?.name && data.emergencyContacts[0]?.nameKana && data.emergencyContacts[0]?.phone),
    !!data.profilePhotoFileName,
    data.freeeSignNoticeAcknowledged,
  ]
  return Math.round(checks.filter(Boolean).length / checks.length * 100)
}

// ── メインコンポーネント ─────────────────────────────────

export default function OnboardingForm() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const d = { ...getInitialState(), ...JSON.parse(saved) }
        d.familyMembers = (d.familyMembers || []).map(m => ({ nameKana: '', ...m }))
        if (d.bankName === '住信SBIネット銀行') d.bankName = 'ドコモSMTBネット銀行' // 行名変更前の下書き
        return d
      }
    } catch {
      // 壊れた下書きは読み飛ばして初期状態を使う
    }
    return getInitialState()
  })
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [mailResult, setMailResult] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [lookingUp, setLookingUp] = useState({ registered: false, current: false })
  const [healthCertFile, setHealthCertFile] = useState(null)
  const [profilePhotoFile, setProfilePhotoFile] = useState(null)
  const healthCertRef = useRef(null)
  const profilePhotoRef = useRef(null)

  useEffect(() => {
    const prev = document.title
    document.title = '10X Joining form'
    return () => { document.title = prev }
  }, [])

  const u = (field, value) => setData(prev => ({ ...prev, [field]: value }))

  function updateEmergency(index, field, value) {
    setData(prev => ({
      ...prev,
      emergencyContacts: prev.emergencyContacts.map((c, i) => i === index ? { ...c, [field]: value } : c)
    }))
  }

  function updateFamilyMember(id, field, value) {
    setData(prev => ({
      ...prev,
      familyMembers: prev.familyMembers.map(m => m.id === id ? { ...m, [field]: value } : m)
    }))
  }

  function addFamilyMember() {
    setData(prev => ({
      ...prev,
      familyMembers: [...prev.familyMembers, { id: Date.now(), name: '', nameKana: '', relationship: '', birthDate: '', gender: '', occupation: '', myNumber: '' }]
    }))
  }

  function removeFamilyMember(id) {
    setData(prev => ({ ...prev, familyMembers: prev.familyMembers.filter(m => m.id !== id) }))
  }

  function updateLeg(id, field, value) {
    setData(prev => ({ ...prev, commutingLegs: prev.commutingLegs.map(l => l.id === id ? { ...l, [field]: value } : l) }))
  }

  function addLeg() {
    setData(prev => ({
      ...prev,
      commutingLegs: [...prev.commutingLegs, { id: Date.now(), method: 'train', from: '', to: '', fare: '' }]
    }))
  }

  function removeLeg(id) {
    setData(prev => ({ ...prev, commutingLegs: prev.commutingLegs.filter(l => l.id !== id) }))
  }

  function handleCommutingChange(value) {
    setData(prev => {
      const next = { ...prev, hasCommuting: value }
      if (value === 'yes' && prev.commutingLegs.length === 0) {
        next.commutingLegs = [{ id: Date.now(), method: 'train', from: '', to: '', fare: '' }]
      }
      return next
    })
  }

  async function lookupPostalCode(code, type) {
    const clean = code.replace(/-/g, '')
    if (clean.length !== 7) return
    setLookingUp(prev => ({ ...prev, [type]: true }))
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${clean}`)
      const json = await res.json()
      if (json.results?.[0]) {
        const { address1, address2, address3 } = json.results[0]
        const addr = address1 + address2 + address3
        if (type === 'registered') u('registeredAddress', addr)
        else u('currentAddress', addr)
      }
    } catch {
      // 住所検索に失敗しても手入力できるため、フォーム操作を継続する
    }
    finally { setLookingUp(prev => ({ ...prev, [type]: false })) }
  }

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    setSavedAt(new Date().toLocaleTimeString('ja-JP'))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    if (!isValidEmail(data.email)) {
      setSubmitError('メールアドレスを正しく入力してください（④ れんらくさき）。送信内容の控えをお送りします。')
      return
    }
    if (data.email.trim() !== data.emailConfirm.trim()) {
      setSubmitError('確認用のメールアドレスが一致しません（④ れんらくさき）。')
      return
    }
    if (!data.freeeSignNoticeAcknowledged) {
      setSubmitError('⑩ freeeサインから誓約書が届くことの確認にチェックしてください。')
      return
    }
    if (!profilePhotoFile) {
      setSubmitError('プロフィール写真は必須です。ファイルを選択してください。')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    handleSave()

    // 開発環境で ?demo=1 のときは DB に保存せず画面の流れだけ確認する
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1') {
      await new Promise(r => setTimeout(r, 600))
      setMailResult({ status: 'ok', userSent: true, hrSent: true, demo: true })
      setSubmitted(true)
      setSubmitting(false)
      return
    }

    try {
      const submissionId = crypto.randomUUID()
      let healthCertPath = null, profilePhotoPath = null

      if (healthCertFile) {
        try {
          const ext = healthCertFile.name.split('.').pop().toLowerCase()
          const path = `${submissionId}/health_cert.${ext}`
          const { error } = await supabase.storage.from('onboarding-files').upload(path, healthCertFile)
          if (!error) healthCertPath = path
        } catch (e) { console.warn('健康診断書アップロード失敗', e) }
      }
      if (profilePhotoFile) {
        try {
          const ext = profilePhotoFile.name.split('.').pop().toLowerCase()
          const path = `${submissionId}/profile_photo.${ext}`
          const { error } = await supabase.storage.from('onboarding-files').upload(path, profilePhotoFile)
          if (!error) profilePhotoPath = path
        } catch (e) { console.warn('写真アップロード失敗', e) }
      }

      const { error: dbError } = await supabase.from('onboarding_submissions').insert({
        id: submissionId,
        last_name: data.lastName, first_name: data.firstName,
        last_name_kana: data.lastNameKana, first_name_kana: data.firstNameKana,
        employment_date: data.employmentDate || null, birth_date: data.birthDate || null,
        gender: data.gender, has_spouse: data.hasSpouse, widow_status: data.widowStatus,
        has_disability: data.hasDisability, is_working_student: data.isWorkingStudent,
        registered_postal_code: data.registeredPostalCode, registered_address: data.registeredAddress,
        registered_address_detail: data.registeredAddressDetail, same_address: data.sameAddress,
        current_postal_code: data.currentPostalCode, current_address: data.currentAddress,
        current_address_detail: data.currentAddressDetail,
        household_head: data.householdHead, household_relationship: data.householdRelationship,
        has_family_members: data.hasFamilyMembers, family_members: data.familyMembers,
        phone_number: data.phoneNumber, email: data.email.trim(),
        employment_insurance_number: data.employmentInsuranceLater ? '後日連絡' : data.employmentInsuranceNumber,
        my_number: data.myNumber,
        spouse_my_number: (data.hasSpouse === 'yes' && data.spouseDependent === 'yes') ? data.spouseMyNumber : '',
        spouse_name: data.hasSpouse === 'yes' ? data.spouseName : null,
        spouse_name_kana: data.hasSpouse === 'yes' ? data.spouseNameKana : null,
        spouse_birth_date: data.hasSpouse === 'yes' ? (data.spouseBirthDate || null) : null,
        spouse_gender: data.hasSpouse === 'yes' ? data.spouseGender : null,
        spouse_occupation: data.hasSpouse === 'yes' ? data.spouseOccupation : null,
        spouse_dependent: data.hasSpouse === 'yes' ? data.spouseDependent : null,
        basic_pension_number: data.basicPensionLater ? '後日連絡' : data.basicPensionNumber, bank_name: data.bankName,
        bank_branch_name: data.bankBranchName, bank_account_type: data.bankAccountType,
        bank_account_number: data.bankAccountNumber, bank_account_holder: data.bankAccountHolder,
        emergency_contacts: data.emergencyContacts, has_commuting: data.hasCommuting,
        commuting_destination_name: data.commutingDestinationName,
        commuting_destination_address: data.commutingDestinationAddress,
        commuting_legs: data.commutingLegs,
        health_cert_path: healthCertPath, profile_photo_path: profilePhotoPath,
        freee_sign_notice_acknowledged: data.freeeSignNoticeAcknowledged,
      })

      if (dbError) throw dbError

      // 本人・人事へ確認メール（失敗しても送信自体は完了扱い）
      try {
        setMailResult(await requestConfirmationMail(submissionId))
      } catch (e) {
        console.warn('確認メール送信失敗', e)
        setMailResult({ status: 'error' })
      }

      const webhookUrl = import.meta.env.VITE_GOOGLE_CHAT_WEBHOOK_URL
      if (webhookUrl) {
        const name = `${data.lastName} ${data.firstName}`.trim() || '（名前未入力）'
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `🎉 入社フォームが提出されました\n氏名: *${name}*\n入社予定日: ${data.employmentDate || '未入力'}\n\n👉 管理画面で確認: https://tenx-joinform.pages.dev/onboarding-admin` }),
        }).catch(() => {})
      }

      localStorage.removeItem(STORAGE_KEY)
      setSubmitted(true)
    } catch (err) {
      console.error('onboarding submit error:', err)
      setSubmitError(`送信に失敗しました: ${err?.message || JSON.stringify(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const needsFare = m => m === 'train' || m === 'bus'
  const spouseIsDependent = data.hasSpouse === 'yes' && data.spouseDependent === 'yes'

  // ── 送信完了画面 ─────────────────────────────────────
  if (submitted) {
    return (
      <div className="dq-page flex items-center justify-center min-h-screen p-4">
        <div className="dq-window p-8 max-w-sm w-full text-center">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>★</div>
          <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '2' }}>
            おめでとう！<br />
            にゅうしゃじょうほうを<br />
            そうしんしました！
          </p>
          {mailResult?.status === 'ok' && mailResult.userSent ? (
            <div className="dq-window-sm p-3" style={{ marginBottom: '1rem', borderColor: '#00d080' }}>
              <p style={{ fontFamily: 'DotGothic16, monospace', color: '#00d080', fontSize: '0.8rem', lineHeight: '1.9' }}>
                ✉ そうしんないようの ひかえを<br />
                <span style={{ color: '#f8d800', wordBreak: 'break-all' }}>{data.email}</span><br />
                に おくりました
              </p>
              <p style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.7rem', marginTop: '0.4rem', lineHeight: '1.8' }}>
                届かない場合は迷惑メールフォルダをご確認ください
                {mailResult.demo && <><br />（デモモード：実際には送信していません）</>}
              </p>
            </div>
          ) : mailResult && mailResult.status !== 'disabled' ? (
            <p style={{ fontFamily: 'DotGothic16, monospace', color: '#ff9060', fontSize: '0.75rem', lineHeight: '1.9', marginBottom: '1rem' }}>
              ※ 控えメールを送れませんでした。<br />入力内容は受け付けています。
            </p>
          ) : null}
          <p style={{ fontFamily: 'DotGothic16, monospace', color: '#a0a0d0', fontSize: '0.8rem', lineHeight: '2' }}>
            担当者が内容を確認いたします。<br />
            不明点があればご連絡します。
          </p>
          <div style={{ marginTop: '2rem' }}>
            <button onClick={() => setSubmitted(false)} className="dq-btn-ghost px-4 py-2 text-sm">
              ▷ 内容を確認・修正する
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── メインフォーム ────────────────────────────────────
  return (
    <div className="dq-page">

      {/* タイトルバー */}
      <div style={{ background: '#000040', borderBottom: '3px solid #f8d800', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0.5rem 1rem' }}>
          {/* タイトル行 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.95rem' }}>
              ⚔ にゅうしゃじょうほうクエスト
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {savedAt && <span style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.7rem' }}>{savedAt} ほぞん済</span>}
              <button type="button" onClick={handleSave} className="dq-btn-ghost px-3 py-1.5 text-sm flex items-center gap-1">
                <Save size={13} /> ほぞん
              </button>
            </div>
          </div>
          {/* 進捗バー（勇者が左→右へ） */}
          {(() => {
            const progress = calcProgress(data)
            const warriorPos = Math.max(2, Math.min(progress, 96))
            return (
              <div>
                <div style={{ position: 'relative', height: '22px' }}>
                  {/* トラック（背景） */}
                  <div style={{ position: 'absolute', top: '50%', left: '10px', right: '10px', height: '3px', background: '#202060', transform: 'translateY(-50%)' }} />
                  {/* トラック（塗り） */}
                  <div style={{ position: 'absolute', top: '50%', left: '10px', width: `calc(${warriorPos}% - 10px)`, height: '3px', background: '#f8d800', transform: 'translateY(-50%)', transition: 'width 0.4s ease' }} />
                  {/* スタート旗 */}
                  <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', lineHeight: 1 }}>🏠</span>
                  {/* ゴール城 */}
                  <span style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', lineHeight: 1 }}>🏯</span>
                  {/* 勇者 */}
                  <span style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${warriorPos}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: '1rem',
                    lineHeight: 1,
                    transition: 'left 0.4s ease',
                    zIndex: 2,
                    filter: 'drop-shadow(0 0 3px #f8d800)'
                  }}>⚔</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'DotGothic16, monospace', fontSize: '0.6rem', marginTop: '2px' }}>
                  <span style={{ color: '#4040a0' }}>とちゅうほぞん ができます</span>
                  <span style={{ color: progress === 100 ? '#f8d800' : '#6060a0' }}>{progress}% {progress === 100 ? '★クリア！' : ''}</span>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>

        {/* ── ① 基本情報 ── */}
        <DQSection icon="👤" title="① きほんじょうほう  Basic Information">

          <DQSubSection title="氏名 / Name">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <DQField label="姓（せい）" required>
                <DQInput value={data.lastName} onChange={e => u('lastName', e.target.value)} placeholder="山田" />
              </DQField>
              <DQField label="名（めい）" required>
                <DQInput value={data.firstName} onChange={e => u('firstName', e.target.value)} placeholder="太郎" />
              </DQField>
              <DQField label="姓（カタカナ）" required>
                <DQInput value={data.lastNameKana} onChange={e => u('lastNameKana', e.target.value)} placeholder="ヤマダ" />
              </DQField>
              <DQField label="名（カタカナ）" required>
                <DQInput value={data.firstNameKana} onChange={e => u('firstNameKana', e.target.value)} placeholder="タロウ" />
              </DQField>
            </div>
          </DQSubSection>

          <DQSubSection title="基本事項">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <DQField label="入社年月日" required>
                <DQInput type="date" value={data.employmentDate} onChange={e => u('employmentDate', e.target.value)} />
              </DQField>
              <DQField label="生年月日" required>
                <DQInput type="date" value={data.birthDate} onChange={e => u('birthDate', e.target.value)} />
              </DQField>
              <DQField label="性別" required>
                <DQRadioGroup name="gender" value={data.gender} onChange={v => u('gender', v)}
                  options={[{ value: 'male', label: 'おとこ（男）' }, { value: 'female', label: 'おんな（女）' }]} />
              </DQField>
            </div>
          </DQSubSection>

          <DQSubSection title="税務関連情報">
            <div className="space-y-4 mb-4">
              <DQField label="寡婦・ひとり親" required>
                <DQRadioGroup name="widowStatus" value={data.widowStatus} onChange={v => u('widowStatus', v)}
                  options={[{ value: 'widow', label: '寡婦' }, { value: 'singleParent', label: 'ひとり親' }, { value: 'none', label: '対象外' }]} />
              </DQField>
              <DQField label="障害" required>
                <DQRadioGroup name="hasDisability" value={data.hasDisability} onChange={v => u('hasDisability', v)}
                  options={[{ value: 'yes', label: 'あり' }, { value: 'no', label: 'なし' }]} />
              </DQField>
              <DQField label="勤労学生" required>
                <DQRadioGroup name="isWorkingStudent" value={data.isWorkingStudent} onChange={v => u('isWorkingStudent', v)}
                  options={[{ value: 'yes', label: '該当あり' }, { value: 'no', label: '該当なし' }]} />
              </DQField>
            </div>
          </DQSubSection>

          <DQSubSection title="住所 / Address">
            <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.8rem', marginBottom: '0.5rem' }}>住民票住所</p>
            <div className="space-y-3 mb-5">
              <DQField label="郵便番号" required>
                <div className="flex gap-2">
                  <DQInput value={data.registeredPostalCode} onChange={e => u('registeredPostalCode', e.target.value)} placeholder="123-4567" maxLength={8} className="max-w-[160px]" />
                  <DQSearchButton onClick={() => lookupPostalCode(data.registeredPostalCode, 'registered')} loading={lookingUp.registered} />
                </div>
              </DQField>
              <DQField label="都道府県・市区町村・町域" required>
                <DQInput value={data.registeredAddress} onChange={e => u('registeredAddress', e.target.value)} placeholder="東京都渋谷区恵比寿" />
              </DQField>
              <DQField label="番地・建物名・部屋番号" required>
                <DQInput value={data.registeredAddressDetail} onChange={e => u('registeredAddressDetail', e.target.value)} placeholder="1-2-3 ○○マンション101号" />
              </DQField>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.8rem' }}>現住所</p>
              <label className="dq-cursor-item" style={{ padding: '0.2rem 0.4rem' }}>
                <span style={{ minWidth: '1em', color: data.sameAddress ? '#f8d800' : 'transparent' }}>▶</span>
                <input type="checkbox" checked={data.sameAddress} onChange={e => u('sameAddress', e.target.checked)} style={{ display: 'none' }} />
                <span style={{ fontSize: '0.85rem', color: data.sameAddress ? '#f8d800' : '#a0a0d0' }}>住民票住所と同じ</span>
              </label>
            </div>

            {!data.sameAddress && (
              <div className="space-y-3">
                <DQField label="郵便番号">
                  <div className="flex gap-2">
                    <DQInput value={data.currentPostalCode} onChange={e => u('currentPostalCode', e.target.value)} placeholder="123-4567" maxLength={8} className="max-w-[160px]" />
                    <DQSearchButton onClick={() => lookupPostalCode(data.currentPostalCode, 'current')} loading={lookingUp.current} />
                  </div>
                </DQField>
                <DQField label="都道府県・市区町村・町域">
                  <DQInput value={data.currentAddress} onChange={e => u('currentAddress', e.target.value)} placeholder="東京都渋谷区恵比寿" />
                </DQField>
                <DQField label="番地・建物名・部屋番号">
                  <DQInput value={data.currentAddressDetail} onChange={e => u('currentAddressDetail', e.target.value)} placeholder="1-2-3 ○○マンション101号" />
                </DQField>
              </div>
            )}
          </DQSubSection>

          <DQSubSection title="世帯情報">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DQField label="世帯主氏名" required>
                <DQInput value={data.householdHead} onChange={e => u('householdHead', e.target.value)} placeholder="山田 太郎" />
              </DQField>
              <DQField label="世帯主との続柄" required>
                <DQInput value={data.householdRelationship} onChange={e => u('householdRelationship', e.target.value)} placeholder="本人・父・夫など" />
              </DQField>
            </div>
          </DQSubSection>
        </DQSection>

        {/* ── ② 配偶者 ── */}
        <DQSection icon="💍" title="② はいぐうしゃ  Spouse">
          <DQField label="配偶者" required>
            <DQRadioGroup name="hasSpouse" value={data.hasSpouse} onChange={v => u('hasSpouse', v)}
              options={[{ value: 'yes', label: 'あり' }, { value: 'no', label: 'なし' }]} />
          </DQField>

          {data.hasSpouse === 'yes' && (
            <div className="dq-window-sm p-4 mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DQField label="氏名" required>
                  <DQInput value={data.spouseName} onChange={e => u('spouseName', e.target.value)} placeholder="山田 花子" />
                </DQField>
                <DQField label="氏名（フリガナ）" required>
                  <DQInput value={data.spouseNameKana} onChange={e => u('spouseNameKana', e.target.value)} placeholder="ヤマダ ハナコ" />
                </DQField>
                <DQField label="生年月日" required>
                  <DQInput type="date" value={data.spouseBirthDate} onChange={e => u('spouseBirthDate', e.target.value)} />
                </DQField>
                <DQField label="性別" required>
                  <DQRadioGroup name="spouseGender" value={data.spouseGender} onChange={v => u('spouseGender', v)}
                    options={[{ value: 'male', label: 'おとこ' }, { value: 'female', label: 'おんな' }]} />
                </DQField>
                <DQField label="職業" required>
                  <DQInput value={data.spouseOccupation} onChange={e => u('spouseOccupation', e.target.value)} placeholder="会社員・パート・無職など" />
                </DQField>
                <div className="sm:col-span-2">
                  <DQField label="扶養" required hint="「扶養する」を選ぶと ③ ふようかぞく に載ります（マイナンバーをそちらで入力）">
                    <DQRadioGroup name="spouseDependent" value={data.spouseDependent} onChange={v => u('spouseDependent', v)}
                      options={[{ value: 'yes', label: '扶養する' }, { value: 'no', label: '扶養しない' }]} />
                  </DQField>
                </div>
              </div>
            </div>
          )}
        </DQSection>

        {/* ── ③ 扶養家族 ── */}
        <DQSection icon="👨‍👩‍👧" title="③ ふようかぞく  Dependents">
          {spouseIsDependent && (
            <div className="dq-window-sm p-4 mb-4">
              <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.85rem', marginBottom: '0.75rem' }}>はいぐうしゃ（② から自動で載ります）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3" style={{ fontFamily: 'DotGothic16, monospace', fontSize: '0.8rem', color: '#c0c0f0' }}>
                <span>氏名：{data.spouseName || '（未入力）'}</span>
                <span>フリガナ：{data.spouseNameKana || '（未入力）'}</span>
                <span>続柄：配偶者</span>
                <span>生年月日：{data.spouseBirthDate || '（未入力）'}</span>
                <span>性別：{{ male: 'おとこ', female: 'おんな' }[data.spouseGender] || '（未入力）'}</span>
                <span className="sm:col-span-2">職業：{data.spouseOccupation || '（未入力）'}</span>
              </div>
              <DQField label="配偶者のマイナンバー" required>
                <DQInput value={data.spouseMyNumber} onChange={e => u('spouseMyNumber', e.target.value)} placeholder="12桁の数字" maxLength={12} className="max-w-xs" />
              </DQField>
            </div>
          )}
          <DQField label={spouseIsDependent ? '配偶者以外に扶養家族はいますか？' : '扶養家族はいますか？'} required>
            <DQRadioGroup name="hasFamilyMembers" value={data.hasFamilyMembers} onChange={v => u('hasFamilyMembers', v)}
              options={[{ value: 'yes', label: 'あり' }, { value: 'no', label: 'なし' }]} />
          </DQField>

          {data.hasFamilyMembers === 'yes' && (
            <div className="mt-4 space-y-4">
              {data.familyMembers.map((member, idx) => (
                <div key={member.id} className="dq-window-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.85rem' }}>なかま {idx + 1}</span>
                    <button type="button" onClick={() => removeFamilyMember(member.id)} className="dq-btn-ghost px-2 py-1 text-xs">✕ 削除</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <DQField label="氏名" required><DQInput value={member.name} onChange={e => updateFamilyMember(member.id, 'name', e.target.value)} placeholder="山田 花子" /></DQField>
                    <DQField label="氏名（フリガナ）" required><DQInput value={member.nameKana || ''} onChange={e => updateFamilyMember(member.id, 'nameKana', e.target.value)} placeholder="ヤマダ ハナコ" /></DQField>
                    <DQField label="続柄" required><DQInput value={member.relationship} onChange={e => updateFamilyMember(member.id, 'relationship', e.target.value)} placeholder="子・父・母など（配偶者は②で入力）" /></DQField>
                    <DQField label="生年月日" required><DQInput type="date" value={member.birthDate} onChange={e => updateFamilyMember(member.id, 'birthDate', e.target.value)} /></DQField>
                    <DQField label="性別" required>
                      <DQRadioGroup name={`fg_${member.id}`} value={member.gender} onChange={v => updateFamilyMember(member.id, 'gender', v)}
                        options={[{ value: 'male', label: 'おとこ' }, { value: 'female', label: 'おんな' }]} />
                    </DQField>
                    <div className="sm:col-span-2">
                      <DQField label="職業" required><DQInput value={member.occupation || ''} onChange={e => updateFamilyMember(member.id, 'occupation', e.target.value)} placeholder="学生・無職・パートなど" /></DQField>
                    </div>
                  </div>
                  <DQField label="マイナンバー（扶養家族の場合）">
                    <DQInput value={member.myNumber} onChange={e => updateFamilyMember(member.id, 'myNumber', e.target.value)} placeholder="12桁の数字" maxLength={12} />
                  </DQField>
                </div>
              ))}
              <button type="button" onClick={addFamilyMember} className="dq-btn-ghost w-full py-2 text-sm flex items-center justify-center gap-2">
                <Plus size={14} /> なかまを ついかする
              </button>
            </div>
          )}
        </DQSection>

        {/* ── ④ 連絡先 ── */}
        <DQSection icon="📞" title="④ れんらくさき  Contact">
          <DQField label="携帯電話番号" required hint="この番号は名刺に記載されます">
            <DQInput value={data.phoneNumber} onChange={e => u('phoneNumber', e.target.value)} placeholder="090-1234-5678" type="tel" className="max-w-xs" />
          </DQField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ marginTop: '1rem' }}>
            <DQField label="メールアドレス" required hint="送信内容の控えをこのアドレスにお送りします">
              <DQInput value={data.email} onChange={e => u('email', e.target.value)} placeholder="example@gmail.com" type="email" />
            </DQField>
            <DQField label="メールアドレス（確認用）" required>
              <DQInput value={data.emailConfirm} onChange={e => u('emailConfirm', e.target.value)} placeholder="もう一度入力" type="email" />
              {data.emailConfirm && data.email.trim() !== data.emailConfirm.trim() && (
                <p className="dq-hint" style={{ color: '#ff6060' }}>▷ メールアドレスが一致しません</p>
              )}
            </DQField>
          </div>
        </DQSection>

        {/* ── ⑤ 各種番号 ── */}
        <DQSection icon="🔢" title="⑤ かくしゅばんごう  ID Numbers">
          <div className="space-y-4">
            <DQField label="雇用保険被保険者番号" required>
              <DQInput value={data.employmentInsuranceNumber} onChange={e => u('employmentInsuranceNumber', e.target.value)} placeholder="1234-567890-1" className="max-w-xs" disabled={data.employmentInsuranceLater} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', cursor: 'pointer', fontFamily: 'DotGothic16, monospace', color: data.employmentInsuranceLater ? '#f8d800' : '#6060a0', fontSize: '0.78rem' }}>
                <input type="checkbox" checked={data.employmentInsuranceLater} onChange={e => { u('employmentInsuranceLater', e.target.checked); if (e.target.checked) u('employmentInsuranceNumber', '') }} style={{ accentColor: '#f8d800', width: '14px', height: '14px' }} />
                不明・後日連絡する
              </label>
            </DQField>
            <DQField label="マイナンバー（本人）" required>
              <DQInput value={data.myNumber} onChange={e => u('myNumber', e.target.value)} placeholder="12桁の数字" maxLength={12} className="max-w-xs" />
            </DQField>
            <DQField label="基礎年金番号" required>
              <DQInput value={data.basicPensionNumber} onChange={e => u('basicPensionNumber', e.target.value)} placeholder="1234-567890" className="max-w-xs" disabled={data.basicPensionLater} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', cursor: 'pointer', fontFamily: 'DotGothic16, monospace', color: data.basicPensionLater ? '#f8d800' : '#6060a0', fontSize: '0.78rem' }}>
                <input type="checkbox" checked={data.basicPensionLater} onChange={e => { u('basicPensionLater', e.target.checked); if (e.target.checked) u('basicPensionNumber', '') }} style={{ accentColor: '#f8d800', width: '14px', height: '14px' }} />
                不明・後日連絡する
              </label>
            </DQField>
          </div>
        </DQSection>

        {/* ── ⑥ 振込口座 ── */}
        <DQSection icon="🏦" title="⑥ ふりこみこうざ  Bank Account">
          <div className="dq-window-sm p-3 mb-4" style={{ borderColor: '#4040c0' }}>
            <p style={{ fontFamily: 'DotGothic16, monospace', color: '#a0c0ff', fontSize: '0.8rem', lineHeight: 1.8 }}>
              ▷ 給与振込はドコモSMTBネット銀行（旧 住信SBIネット銀行）でお願いしております。<br />
                未開設の方は <span style={{ color: '#f8d800' }}>netbk.co.jp/contents/account-2</span> からご開設ください。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DQField label="銀行名" required>
              <DQInput value={data.bankName} onChange={e => u('bankName', e.target.value)} placeholder="ドコモSMTBネット銀行" />
            </DQField>
            <DQField label="支店名" required>
              <DQInput value={data.bankBranchName} onChange={e => u('bankBranchName', e.target.value)} placeholder="○○支店" />
            </DQField>
            <DQField label="口座種別" required>
              <DQRadioGroup name="bankAccountType" value={data.bankAccountType} onChange={v => u('bankAccountType', v)}
                options={[{ value: 'ordinary', label: '普通' }, { value: 'current', label: '当座' }]} />
            </DQField>
            <DQField label="口座番号" required>
              <DQInput value={data.bankAccountNumber} onChange={e => u('bankAccountNumber', e.target.value)} placeholder="1234567" maxLength={8} />
            </DQField>
            <div className="sm:col-span-2">
              <DQField label="口座名義（カタカナ）" required>
                <DQInput value={data.bankAccountHolder} onChange={e => u('bankAccountHolder', e.target.value)} placeholder="ヤマダ タロウ" className="max-w-xs" />
              </DQField>
            </div>
          </div>
        </DQSection>

        {/* ── ⑦ 緊急連絡先 ── */}
        <DQSection icon="🆘" title="⑦ きんきゅうれんらくさき  Emergency Contacts">
          <p style={{ fontFamily: 'DotGothic16, monospace', color: '#8080c0', fontSize: '0.8rem', marginBottom: '1rem' }}>
            ▷ 1名は必須です（最大3名）
          </p>
          <div className="space-y-5">
            {data.emergencyContacts.map((c, idx) => (
              <div key={idx} className="dq-window-sm p-4">
                <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                  れんらくさき {idx + 1} {idx === 0 && <span style={{ color: '#ff6060' }}>（ひっす）</span>}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DQField label="続柄" required={idx === 0}><DQInput value={c.relationship} onChange={e => updateEmergency(idx, 'relationship', e.target.value)} placeholder="父・母など" /></DQField>
                  <DQField label="氏名" required={idx === 0}><DQInput value={c.name} onChange={e => updateEmergency(idx, 'name', e.target.value)} placeholder="山田 一郎" /></DQField>
                  <DQField label="氏名（フリガナ）" required={idx === 0}><DQInput value={c.nameKana} onChange={e => updateEmergency(idx, 'nameKana', e.target.value)} placeholder="ヤマダ イチロウ" /></DQField>
                  <DQField label="電話番号" required={idx === 0}><DQInput value={c.phone} onChange={e => updateEmergency(idx, 'phone', e.target.value)} placeholder="090-1234-5678" type="tel" /></DQField>
                  <div className="sm:col-span-2"><DQField label="住所"><DQInput value={c.address} onChange={e => updateEmergency(idx, 'address', e.target.value)} placeholder="東京都渋谷区..." /></DQField></div>
                  <div className="sm:col-span-2"><DQField label="メールアドレス" hint="不明の場合は「不明」と記入"><DQInput value={c.email} onChange={e => updateEmergency(idx, 'email', e.target.value)} placeholder="example@email.com または 不明" /></DQField></div>
                </div>
              </div>
            ))}
          </div>
        </DQSection>

        {/* ── ⑧ 通勤申請 ── */}
        <DQSection icon="🚃" title="⑧ つうきんしんせい  Commuting">
          <DQField label="通勤費の申請" required>
            <DQRadioGroup name="hasCommuting" value={data.hasCommuting} onChange={handleCommutingChange}
              options={[{ value: 'yes', label: 'あり' }, { value: 'no', label: 'なし' }]} />
          </DQField>

          {data.hasCommuting === 'yes' && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DQField label="通勤先名称" required><DQInput value={data.commutingDestinationName} onChange={e => u('commutingDestinationName', e.target.value)} placeholder="○○オフィス" /></DQField>
                <DQField label="通勤先住所" required><DQInput value={data.commutingDestinationAddress} onChange={e => u('commutingDestinationAddress', e.target.value)} placeholder="東京都渋谷区..." /></DQField>
              </div>

              <div style={{ borderTop: '1px solid #4040a0', paddingTop: '1rem' }}>
                <p style={{ fontFamily: 'DotGothic16, monospace', color: '#a0c0ff', fontSize: '0.85rem', marginBottom: '0.25rem' }}>通勤方法・区間内訳</p>
                <p style={{ fontFamily: 'DotGothic16, monospace', color: '#8080c0', fontSize: '0.75rem', marginBottom: '0.75rem' }}>▷ 区間1は必須です</p>

                {data.commutingLegs.length > 0 && (
                  <div className="space-y-3 mb-3">
                    <div className="hidden sm:grid gap-2 text-xs" style={{ gridTemplateColumns: '110px 1fr 1fr 90px 30px', fontFamily: 'DotGothic16, monospace', color: '#6060a0', padding: '0 0.25rem' }}>
                      <span>交通手段</span><span>出発</span><span>到着</span><span>1乗車(円)</span><span></span>
                    </div>
                    {data.commutingLegs.map((leg, idx) => (
                      <div key={leg.id} className="dq-window-sm p-3">
                        {idx === 0 && <p style={{ fontFamily: 'DotGothic16, monospace', color: '#ff6060', fontSize: '0.75rem', marginBottom: '0.5rem' }}>区間1（必須）</p>}
                        <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr_90px_30px] gap-2 items-start">
                          <select className="dq-select px-2 py-2 text-sm w-full" value={leg.method} onChange={e => updateLeg(leg.id, 'method', e.target.value)} required={idx === 0}>
                            <option value="train">電車</option>
                            <option value="bus">バス</option>
                            <option value="car">車</option>
                            <option value="bicycle">自転車</option>
                          </select>
                          <DQInput value={leg.from} onChange={e => updateLeg(leg.id, 'from', e.target.value)} placeholder={needsFare(leg.method) ? '○○駅' : '自宅'} required={idx === 0} />
                          <DQInput value={leg.to} onChange={e => updateLeg(leg.id, 'to', e.target.value)} placeholder={needsFare(leg.method) ? '△△駅' : '通勤先'} required={idx === 0} />
                          <DQInput value={leg.fare} onChange={e => updateLeg(leg.id, 'fare', e.target.value)}
                            placeholder={needsFare(leg.method) ? '230' : '—'}
                            type={needsFare(leg.method) ? 'number' : 'text'}
                            disabled={!needsFare(leg.method)}
                            required={idx === 0 && needsFare(leg.method)} />
                          {idx > 0 && (
                            <button type="button" onClick={() => removeLeg(leg.id)} className="dq-btn-ghost px-1 py-2 text-xs">✕</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={addLeg} className="dq-btn-ghost w-full py-2 text-sm flex items-center justify-center gap-2">
                  <Plus size={14} /> 区間を ついかする
                </button>
              </div>
            </div>
          )}
        </DQSection>

        {/* ── ⑨ 書類アップロード ── */}
        <DQSection icon="📄" title="⑨ しょるいアップロード  Documents">
          <div className="space-y-5">
            {/* 健康診断書 */}
            <DQField label="健康診断書（3ヶ月以内が望ましい）">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem', cursor: 'pointer', fontFamily: 'DotGothic16, monospace', color: data.healthCertLater ? '#f8d800' : '#6060a0', fontSize: '0.78rem' }}>
                <input type="checkbox" checked={data.healthCertLater} onChange={e => { u('healthCertLater', e.target.checked); if (e.target.checked) { setHealthCertFile(null); u('healthCertFileName', '') } }} style={{ accentColor: '#f8d800', width: '14px', height: '14px' }} />
                後日提出する
              </label>
              {data.healthCertLater ? (
                <div style={{ border: '2px dashed #4040a0', background: '#00003a', padding: '1.5rem', textAlign: 'center' }}>
                  <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', fontSize: '0.85rem' }}>📅 後日提出</p>
                  <p style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.7rem', marginTop: '0.3rem' }}>担当者より提出期限をご連絡します</p>
                </div>
              ) : (
                <div
                  onClick={() => healthCertRef.current?.click()}
                  style={{ border: '2px dashed #4040a0', background: '#00003a', padding: '1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#f8d800'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#4040a0'}
                >
                  <Upload size={24} style={{ margin: '0 auto 0.5rem', color: healthCertFile ? '#00d080' : '#4040a0' }} />
                  {healthCertFile
                    ? <p style={{ fontFamily: 'DotGothic16, monospace', color: '#00d080', fontSize: '0.85rem' }}>{healthCertFile.name}</p>
                    : <p style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.8rem' }}>クリックしてファイルを選択<br /><span style={{ fontSize: '0.7rem' }}>PDF・PNG・JPG・JPEG・HEIC に対応</span></p>
                  }
                </div>
              )}
              <input ref={healthCertRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,image/heic,image/heif" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setHealthCertFile(f); u('healthCertFileName', f.name) } }} />
            </DQField>

            {/* プロフィール写真 */}
            <DQField label="Googleワークスペース用プロフィール写真" required>
              {/* 見本 */}
              <div style={{ background: '#00002a', border: '1px solid #303070', padding: '0.75rem', marginBottom: '0.75rem' }}>
                <p style={{ fontFamily: 'DotGothic16, monospace', color: '#a0c0ff', fontSize: '0.72rem', marginBottom: '0.5rem' }}>▷ 見本 — このような写真をアップロードしてください</p>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[
                    '/samples/sample5.png',
                    '/samples/sample2.png',
                    '/samples/sample3.png',
                    '/samples/sample4.jpg',
                    '/samples/sample1.jpg',
                  ].map((src, i) => (
                    <img key={i} src={src} alt={`見本${i + 1}`} style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #4040a0', flexShrink: 0 }} />
                  ))}
                  <div style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.65rem', lineHeight: 1.8 }}>
                    <div style={{ color: '#00d080' }}>✓ 上半身</div>
                    <div style={{ color: '#00d080' }}>✓ 顔が明瞭に写っている</div>
                    <div style={{ color: '#ff8080' }}>✗ サングラス・帽子NG</div>
                  </div>
                </div>
              </div>
              <div
                onClick={() => profilePhotoRef.current?.click()}
                style={{ border: '2px dashed #4040a0', background: '#00003a', padding: '1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#f8d800'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#4040a0'}
              >
                {profilePhotoFile && profilePhotoFile.type.startsWith('image/') && !profilePhotoFile.type.includes('heic') ? (
                  <div>
                    <img src={URL.createObjectURL(profilePhotoFile)} alt="preview"
                      style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '50%', margin: '0 auto 0.5rem', border: '2px solid #f8d800' }} />
                    <p style={{ fontFamily: 'DotGothic16, monospace', color: '#00d080', fontSize: '0.85rem' }}>{profilePhotoFile.name}</p>
                  </div>
                ) : profilePhotoFile ? (
                  <p style={{ fontFamily: 'DotGothic16, monospace', color: '#00d080', fontSize: '0.85rem' }}>{profilePhotoFile.name}</p>
                ) : (
                  <p style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.8rem' }}>クリックしてファイルを選択<br /><span style={{ fontSize: '0.7rem' }}>PNG・JPG・JPEG・HEIC に対応</span></p>
                )}
              </div>
              <input ref={profilePhotoRef} type="file" accept=".png,.jpg,.jpeg,.heic,.heif,image/heic,image/heif" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setProfilePhotoFile(f); u('profilePhotoFileName', f.name) } }} />
            </DQField>
          </div>
        </DQSection>

        {/* ── ⑩ freeeサイン案内確認 ── */}
        <DQSection icon="📜" title="⑩ せいやくしょ  Pledge Agreement">
          <div className="dq-window-sm p-4" style={{ borderColor: '#4040c0' }}>
            <p style={{ fontFamily: 'DotGothic16, monospace', color: '#a0c0ff', fontSize: '0.82rem', lineHeight: 2, marginBottom: '1rem' }}>
              ▷ このフォームの送信後、10Xよりfreeeサインを通じて秘密保持誓約書をお送りします。<br />
                メールが届きましたら、内容をご確認のうえ署名をお願いします。
            </p>
            <label className="dq-cursor-item" style={{ padding: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ minWidth: '1em', color: data.freeeSignNoticeAcknowledged ? '#f8d800' : 'transparent' }}>▶</span>
              <input
                type="checkbox"
                checked={data.freeeSignNoticeAcknowledged}
                onChange={e => u('freeeSignNoticeAcknowledged', e.target.checked)}
                required
                style={{ accentColor: '#f8d800', width: '18px', height: '18px', marginTop: '0.15rem' }}
              />
              <span style={{ color: data.freeeSignNoticeAcknowledged ? '#f8d800' : '#c0c0f0', lineHeight: 1.8 }}>
                上記を確認しました ＊
              </span>
            </label>
          </div>
        </DQSection>

        {/* ── 送信エリア ── */}
        <div className="dq-window p-6">
          {submitError && (
            <div className="dq-window-sm p-3 mb-4" style={{ borderColor: '#ff4040' }}>
              <p style={{ fontFamily: 'DotGothic16, monospace', color: '#ff6060', fontSize: '0.8rem' }}>{submitError}</p>
            </div>
          )}
          <p style={{ fontFamily: 'DotGothic16, monospace', color: '#f8d800', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 2 }}>
            これでよろしいですか？
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button type="button" onClick={handleSave} disabled={submitting} className="dq-btn-ghost px-8 py-3 text-sm flex items-center justify-center gap-2">
              <Save size={15} /> とちゅうほぞんする
            </button>
            <button type="submit" disabled={submitting} className="dq-btn px-8 py-3 text-sm flex items-center justify-center gap-2">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : '▶'}
              {submitting ? 'そうしん中…' : 'はい、そうしんする'}
            </button>
          </div>
          {savedAt && <p style={{ fontFamily: 'DotGothic16, monospace', color: '#6060a0', fontSize: '0.7rem', textAlign: 'center', marginTop: '0.75rem' }}>さいごのほぞん: {savedAt}</p>}
          <p style={{ fontFamily: 'DotGothic16, monospace', color: '#4040a0', fontSize: '0.7rem', textAlign: 'center', marginTop: '0.5rem' }}>
            ▷ みきにゅうのこうもくがあってもそうしんできます
          </p>
        </div>

      </form>
    </div>
  )
}
