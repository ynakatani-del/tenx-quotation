import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const fmt = (n) => (n === '' || n === null || n === undefined || isNaN(Number(n)))
  ? ''
  : Number(n).toLocaleString('ja-JP')

// 桁区切り付きの金額入力欄
// 入力中も「1,234,000」のようにカンマを付けたまま表示し、
// カーソル位置は「カーソルより左にある数字の個数」で保持する（右端に飛ばない）
// commitDelay（ミリ秒）を指定すると、入力が止まってからその時間後に値を確定する。
// 確定前に欄から離れた（フォーカスを外した）場合は、その時点ですぐ確定する。
export default function AmountInput({ value, onCommit, commitDelay = 0, readOnly = false, className = '' }) {
  const inputRef = useRef(null)
  const focusedRef = useRef(false)
  const pendingCaretRef = useRef(null) // 再描画後に戻すカーソル位置（数字の個数）
  const timerRef = useRef(null)        // 確定待ちのタイマー
  const pendingNumRef = useRef(null)   // 確定待ちの値（null = 確定待ちなし）
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const [text, setText] = useState(fmt(value))

  // 画面を離れるときに確定待ちのタイマーを止める
  useEffect(() => () => clearTimeout(timerRef.current), [])

  // 編集中でなければ、外部の値（自動計算など）の変化を表示に反映
  useLayoutEffect(() => {
    if (!focusedRef.current) setText(fmt(value))
  }, [value])

  // 表示を更新したあと、カーソルを同じ桁の位置に戻す
  useLayoutEffect(() => {
    const digitsBefore = pendingCaretRef.current
    if (digitsBefore === null || !inputRef.current) return
    pendingCaretRef.current = null
    let pos = 0
    let seen = 0
    while (pos < text.length && seen < digitsBefore) {
      if (/\d/.test(text[pos])) seen++
      pos++
    }
    inputRef.current.setSelectionRange(pos, pos)
  }, [text])

  // 確定待ちの値があれば、すぐ確定する（確定した値を返す。なければ null）
  function flushPending() {
    clearTimeout(timerRef.current)
    if (pendingNumRef.current === null) return null
    const num = pendingNumRef.current
    pendingNumRef.current = null
    onCommitRef.current(num)
    return num
  }

  // 生の入力文字列とカーソル位置から、表示とカーソルを更新して値を確定する
  function apply(rawValue, caret) {
    let digits = rawValue.replace(/\D/g, '')
    let digitsBefore = rawValue.slice(0, caret).replace(/\D/g, '').length
    // 先頭の余分な 0 を取り除く（取り除いた分だけカーソル位置も詰める）
    const stripped = digits.replace(/^0+(?=\d)/, '')
    const removed = digits.length - stripped.length
    digitsBefore = Math.max(0, digitsBefore - Math.min(removed, digitsBefore))
    digits = stripped

    pendingCaretRef.current = digitsBefore
    setText(digits === '' ? '' : Number(digits).toLocaleString('ja-JP'))

    const num = digits === '' ? 0 : Number(digits)
    if (commitDelay > 0) {
      // 入力が止まってから commitDelay 後に確定（入力中の表示とカーソルはそのまま）
      pendingNumRef.current = num
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flushPending, commitDelay)
    } else {
      onCommitRef.current(num)
    }
  }

  function handleChange(e) {
    const el = e.target
    apply(el.value, el.selectionStart ?? el.value.length)
  }

  // カンマの直後で Backspace（直前で Delete）を押したら、カンマを飛び越えて隣の数字を消す
  function handleKeyDown(e) {
    const el = e.target
    const start = el.selectionStart
    if (start === null || start !== el.selectionEnd) return
    if (e.key === 'Backspace' && start >= 2 && el.value[start - 1] === ',') {
      e.preventDefault()
      apply(el.value.slice(0, start - 2) + el.value.slice(start - 1), start - 2)
    } else if (e.key === 'Delete' && el.value[start] === ',') {
      e.preventDefault()
      apply(el.value.slice(0, start + 1) + el.value.slice(start + 2), start + 1)
    }
  }

  if (readOnly) {
    return <input type="text" value={fmt(value)} readOnly className={`${className} cursor-default`} />
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={() => { focusedRef.current = true }}
      onBlur={() => {
        focusedRef.current = false
        // 確定待ちがあればすぐ確定し、その値で表示を整える
        const flushed = flushPending()
        setText(fmt(flushed !== null ? flushed : value))
      }}
      className={className}
    />
  )
}
