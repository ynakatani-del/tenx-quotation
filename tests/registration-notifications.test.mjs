import assert from 'node:assert/strict'
import test from 'node:test'
import { receivesRegistrationNotifications } from '../src/lib/registrationNotifications.js'

const recipient = { id: 'reviewer', email: 'Y.NAKATANI@TENX.JP' }
const activeSuperAdmin = { id: recipient.id, role: 'super_admin', status: 'active' }

test('開発中は指定された有効な特権管理者だけに登録申請通知を表示する', () => {
  assert.equal(receivesRegistrationNotifications(recipient, activeSuperAdmin), true)
  assert.equal(receivesRegistrationNotifications(
    { id: 'other', email: 'another-admin@tenx.jp' },
    { ...activeSuperAdmin, id: 'other' },
  ), false)
  assert.equal(receivesRegistrationNotifications(recipient, { ...activeSuperAdmin, role: 'admin' }), false)
  assert.equal(receivesRegistrationNotifications(recipient, { ...activeSuperAdmin, status: 'suspended' }), false)
  assert.equal(receivesRegistrationNotifications(recipient, { ...activeSuperAdmin, id: 'other' }), false)
  assert.equal(receivesRegistrationNotifications(null, activeSuperAdmin), false)
})
