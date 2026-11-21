import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPANY_EMAIL_GUIDANCE as browserGuidance,
  isCompanyEmail as isBrowserCompanyEmail,
  normalizeCompanyEmail as normalizeBrowserCompanyEmail,
} from '../src/lib/companyEmail.js'
import {
  COMPANY_EMAIL_GUIDANCE as serverGuidance,
  isActiveQuotationSuperAdmin,
  isCompanyEmail as isServerCompanyEmail,
  normalizeCompanyEmail as normalizeServerCompanyEmail,
} from '../supabase/functions/_shared/company-email.ts'

const cases = [
  ['user@tenx.jp', true],
  [' USER@TENX.JP ', true],
  ['user@three-side.jp', true],
  [' User@Three-Side.JP ', true],
  ['user@example.com', false],
  ['user@tenx.jp.example.com', false],
  ['user@sub.tenx.jp', false],
  ['user+tag@three-side.jp', true],
  ['@tenx.jp', false],
  ['', false],
]

test('browser and server company-email rules stay identical', () => {
  assert.equal(browserGuidance, serverGuidance)
  for (const [email, expected] of cases) {
    assert.equal(isBrowserCompanyEmail(email), expected, `browser: ${email}`)
    assert.equal(isServerCompanyEmail(email), expected, `server: ${email}`)
    assert.equal(normalizeBrowserCompanyEmail(email), normalizeServerCompanyEmail(email), `normalize: ${email}`)
  }
})

test('only an active company-domain quotation super admin can manage users', () => {
  const activeSuperAdmin = { role: 'super_admin', status: 'active', quotation_suspended: false }
  assert.equal(isActiveQuotationSuperAdmin(activeSuperAdmin, 'admin@tenx.jp'), true)
  assert.equal(isActiveQuotationSuperAdmin(activeSuperAdmin, 'admin@three-side.jp'), true)
  assert.equal(isActiveQuotationSuperAdmin(activeSuperAdmin, 'admin@example.com'), false)
  assert.equal(isActiveQuotationSuperAdmin({ ...activeSuperAdmin, status: 'suspended' }, 'admin@tenx.jp'), false)
  assert.equal(isActiveQuotationSuperAdmin({ ...activeSuperAdmin, quotation_suspended: true }, 'admin@tenx.jp'), false)
  assert.equal(isActiveQuotationSuperAdmin({ ...activeSuperAdmin, role: 'admin' }, 'admin@tenx.jp'), false)
  assert.equal(isActiveQuotationSuperAdmin(null, 'admin@tenx.jp'), false)
})
