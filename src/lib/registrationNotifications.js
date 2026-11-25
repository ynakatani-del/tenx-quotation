import { normalizeCompanyEmail } from './companyEmail.js'

// 開発期間中の登録申請通知先。運用開始時は共通登録メールの宛先と併せて見直す。
const REGISTRATION_NOTIFICATION_EMAIL = 'y.nakatani@tenx.jp'

export function receivesRegistrationNotifications(user, profile) {
  return Boolean(
    user?.id
    && user.id === profile?.id
    && profile.status === 'active'
    && profile.role === 'super_admin'
    && normalizeCompanyEmail(user.email) === REGISTRATION_NOTIFICATION_EMAIL,
  )
}
