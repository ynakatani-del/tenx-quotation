export function canOpenQuotationHandover(user, profile) {
  return Boolean(user?.id && profile?.id === user.id && profile.status === 'active'
    && profile.quotation_suspended === false && profile.role === 'super_admin')
}

export function parseQuotationHandover(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value?.updatedOn ?? '')
    || !Array.isArray(value.sections) || value.sections.length === 0
    || !value.sections.every(section => typeof section?.title === 'string'
      && section.title.trim() && Array.isArray(section.paragraphs)
      && section.paragraphs.length > 0
      && section.paragraphs.every(paragraph => typeof paragraph === 'string'))) {
    throw new Error('Invalid quotation handover format')
  }
  return value
}

export function parseQuotationGuide(value) {
  const topics = value?.topics
  const hasTopic = id => typeof id === 'string' && Object.hasOwn(topics, id)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value?.checkedOn ?? '') || !topics
    || !hasTopic('start')
    || !Object.values(topics).every(topic => typeof topic?.title === 'string'
      && (topic.intro === undefined || typeof topic.intro === 'string')
      && Array.isArray(topic.steps) && topic.steps.every(step => typeof step === 'string')
      && Array.isArray(topic.related) && topic.related.every(hasTopic))
    || !Array.isArray(value.features) || !value.features.every(feature => Array.isArray(feature)
      && feature.length === 6 && feature.every(part => typeof part === 'string') && hasTopic(feature[5]))
    || !Array.isArray(value.releases) || !value.releases.every(release => release
      && ['date', 'title', 'impact', 'action'].every(key => typeof release[key] === 'string')
      && hasTopic(release.topic))) {
    throw new Error('Invalid quotation guide format')
  }
  return value
}

export function quotationGuideContext(pathname) {
  if (/^\/quotations\/[^/]+\/print\/?$/.test(pathname)) return ['print', '印刷の使い方']
  if (/^\/(?:dashboard\/)?quotations\/(?:new|[^/]+\/edit)\/?$/.test(pathname)) return ['create', '見積入力の使い方']
  if (pathname === '/quotations') return ['list', '見積一覧の使い方']
  if (pathname === '/unit-prices') return ['prices', '単価表の使い方']
  if (['/companies', '/customers', '/users', '/settings', '/profile', '/aggregation'].includes(pathname)) return ['settings', '設定・管理の使い方']
  return null
}
