export const COMPANY_EMAIL_GUIDANCE = '10XまたはThree-sideの会社メールアドレス（@tenx.jp / @three-side.jp）を入力してください。'

const COMPANY_EMAIL_PATTERN = /^[^@\s]+@(tenx\.jp|three-side\.jp)$/

export function normalizeCompanyEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

export function isCompanyEmail(value: unknown) {
  return COMPANY_EMAIL_PATTERN.test(normalizeCompanyEmail(value))
}

export function isActiveQuotationSuperAdmin(
  profile: { role?: string | null; status?: string | null; quotation_suspended?: boolean | null } | null,
  email: unknown,
) {
  return isCompanyEmail(email)
    && profile?.role === 'super_admin'
    && profile.status === 'active'
    && !profile.quotation_suspended
}
