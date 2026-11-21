export const COMPANY_EMAIL_GUIDANCE = '10XまたはThree-sideの会社メールアドレス（@tenx.jp / @three-side.jp）を入力してください。'

const COMPANY_EMAIL_PATTERN = /^[^@\s]+@(tenx\.jp|three-side\.jp)$/

export function normalizeCompanyEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isCompanyEmail(value) {
  return COMPANY_EMAIL_PATTERN.test(normalizeCompanyEmail(value))
}
