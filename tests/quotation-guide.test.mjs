import assert from 'node:assert/strict'
import test from 'node:test'
import { canOpenQuotationHandover, parseQuotationGuide, parseQuotationHandover, quotationGuideContext } from '../src/lib/quotationHelpAccess.js'

test('handover entry requires the signed-in active quotation super admin', () => {
  const user = { id: 'test-user' }
  const profile = { id: user.id, status: 'active', role: 'super_admin', quotation_suspended: false }
  assert.equal(canOpenQuotationHandover(user, profile), true)
  for (const role of ['general', 'admin', 'maintenance_admin', null]) {
    assert.equal(canOpenQuotationHandover(user, { ...profile, role, trip_role: 'super_admin', account_console_access: true }), false)
  }
  assert.equal(canOpenQuotationHandover(user, { ...profile, status: 'suspended' }), false)
  assert.equal(canOpenQuotationHandover(user, { ...profile, quotation_suspended: true }), false)
  assert.equal(canOpenQuotationHandover(user, { ...profile, id: 'another-user' }), false)
  assert.equal(canOpenQuotationHandover(null, profile), false)
})

test('handover format accepts only the required display structure', () => {
  const document = { updatedOn: '2026-01-01', sections: [{ title: 'Synthetic', paragraphs: ['Text'] }] }
  assert.equal(parseQuotationHandover(document), document)
  for (const value of [null, {}, { ...document, sections: [] }, { ...document, sections: [{ title: 'synthetic', paragraphs: [null] }] }]) {
    assert.throws(() => parseQuotationHandover(value), /Invalid quotation handover format/)
  }
})

test('screens link to the corresponding guide topic', () => {
  const paths = {
    '/quotations': 'list', '/quotations/new': 'create', '/quotations/test/edit': 'create',
    '/dashboard/quotations/test/edit': 'create', '/quotations/test/print': 'print',
    '/unit-prices': 'prices', '/settings': 'settings',
  }
  for (const [path, topic] of Object.entries(paths)) assert.equal(quotationGuideContext(path)?.[0], topic)
  assert.equal(quotationGuideContext('/login'), null)
})

test('guide parser rejects missing linked topics', () => {
  const entry = { title: 'Synthetic', steps: ['Test'], related: [] }
  const guide = { checkedOn: '2026-01-01', topics: { start: entry }, features: [], releases: [] }
  assert.equal(parseQuotationGuide(guide), guide)
  assert.throws(() => parseQuotationGuide({
    ...guide, topics: { start: { ...entry, related: ['missing'] } },
  }), /Invalid quotation guide format/)
})
