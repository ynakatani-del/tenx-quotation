import { useEffect, useRef, useState } from 'react'

const formatAmount = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('ja-JP') : '0'
}

// マイナスを含む金額入力欄。
// 入力途中の「-」はローカルで保持し、完成した値だけを数値として親へ返す。
export default function SignedAmountInput({ value, onChange, className = '', onKeyDown, ...inputProps }) {
  const [text, setText] = useState(() => formatAmount(value))
  const focusedRef = useRef(false)
  const committedValueRef = useRef(Number(value) || 0)

  useEffect(() => {
    const nextValue = Number(value) || 0
    committedValueRef.current = nextValue
    if (!focusedRef.current) setText(formatAmount(nextValue))
  }, [value])

  function handleChange(event) {
    const normalized = event.target.value
      .replace(/,/g, '')
      .replace(/[－−ー]/g, '-')
      .replace(/．/g, '.')
      .replace(/\s/g, '')

    if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) return

    setText(normalized)
    if (normalized === '-' || normalized === '.' || normalized === '-.') return

    const nextValue = normalized === '' ? 0 : Number(normalized)
    committedValueRef.current = nextValue
    onChange(nextValue)
  }

  return (
    <input
      {...inputProps}
      type="text"
      inputMode="text"
      value={text}
      onChange={handleChange}
      onKeyDown={onKeyDown}
      onFocus={event => {
        const input = event.currentTarget
        focusedRef.current = true
        setText(String(committedValueRef.current))
        requestAnimationFrame(() => input.select())
      }}
      onBlur={() => {
        focusedRef.current = false
        setText(formatAmount(committedValueRef.current))
      }}
      className={className}
    />
  )
}
