import html2canvas from 'html2canvas'

export function layoutEmailPages(source, container) {
  const cover = source.querySelector('[data-email-cover]')
  const detail = source.querySelector('[data-email-detail]')
  const table = detail.querySelector('table')
  const pages = []

  function addPage() {
    const page = document.createElement('div')
    Object.assign(page.style, {
      width: '210mm', height: '297mm', padding: '12mm 12mm 18mm 10mm',
      boxSizing: 'border-box', background: '#fff',
    })
    const body = document.createElement('div')
    page.append(body)
    container.append(page)
    const capacity = page.getBoundingClientRect().height
      - parseFloat(getComputedStyle(page).paddingTop) - parseFloat(getComputedStyle(page).paddingBottom)
    const fits = () => body.getBoundingClientRect().height <= capacity + 0.1
    const result = { page, body, fits, capacity }
    pages.push(result)
    return result
  }

  function copy(element) {
    const clone = element.cloneNode(true)
    clone.querySelectorAll('.no-print').forEach(control => control.remove())
    return clone
  }

  if (cover) addPage().body.append(copy(cover))

  let current
  let tbody
  function addDetailPage() {
    current = addPage()
    const shell = table.cloneNode(false)
    for (const element of table.children) {
      if (element.tagName !== 'TBODY') shell.append(copy(element))
    }
    tbody = shell.createTBody()
    current.body.append(shell)
  }

  let forcedBreak = false
  for (const row of table.tBodies[0].rows) {
    if (row.classList.contains('no-print')) {
      forcedBreak = true
      continue
    }
    if (!tbody || (tbody.rows.length && (forcedBreak || row.style.breakBefore === 'page'))) addDetailPage()
    forcedBreak = false
    const clone = copy(row)
    tbody.append(clone)
    if (!current.fits() && tbody.rows.length > 1) {
      clone.remove()
      addDetailPage()
      tbody.append(clone)
    }
  }

  for (const block of detail.children) {
    if (block === table || block.classList.contains('no-print')) continue
    current ||= addPage()
    const clone = copy(block)
    // A flow root keeps the section's top margin in the height measurement.
    const section = document.createElement('div')
    section.style.display = 'flow-root'
    section.append(clone)
    const hasContent = current.body.childElementCount > 0
    current.body.append(section)
    if (!current.fits() && hasContent) {
      section.remove()
      current = addPage()
      current.body.append(section)
    }
  }

  // Exceptionally tall rows or notes stay intact on their own page.
  for (const { body, fits, capacity } of pages) {
    if (!fits()) body.style.zoom = String(capacity / body.getBoundingClientRect().height)
  }
  return pages.map(({ page }) => page)
}

export async function captureQuotationEmail(source, reference) {
  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'absolute', top: '0', left: '0', width: '210mm', zIndex: '-1',
    fontFamily: getComputedStyle(source).fontFamily,
    fontSize: getComputedStyle(source).fontSize,
  })
  document.body.append(container)
  try {
    await document.fonts.ready
    const pages = layoutEmailPages(source, container)
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    const preview = document.createElement('canvas')
    const previewWidth = Math.min(900, Math.floor(16000 * 210 / (297 * pages.length)))
    const previewHeight = Math.round(previewWidth * 297 / 210)
    preview.width = previewWidth
    preview.height = previewHeight * pages.length
    const ctx = preview.getContext('2d')

    for (const [index, page] of pages.entries()) {
      page.style.position = 'relative'
      const footer = document.createElement('div')
      Object.assign(footer.style, {
        position: 'absolute', bottom: '7mm', left: '10mm', right: '12mm',
        display: 'flex', justifyContent: 'space-between', fontSize: '7pt', color: '#888',
      })
      const label = document.createElement('span')
      label.textContent = index === 0 && source.querySelector('[data-email-cover]') ? '' : reference
      const number = document.createElement('span')
      number.textContent = `${index + 1} / ${pages.length}`
      footer.append(label, number)
      page.append(footer)
      const canvas = await html2canvas(page, {
        scale: 2, useCORS: true, backgroundColor: '#fff', logging: false,
        scrollX: 0, scrollY: 0,
      })
      if (index > 0) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0,
        pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, 'FAST')
      ctx.drawImage(canvas, 0, index * previewHeight, previewWidth, previewHeight)
    }

    return {
      data: preview.toDataURL('image/jpeg', 0.84).split(',')[1],
      pdfData: pdf.output('datauristring').split(',')[1],
    }
  } finally {
    container.remove()
  }
}
