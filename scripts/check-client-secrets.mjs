import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const mode = process.argv[2]
if (!['source', 'dist'].includes(mode)) {
  console.error('Usage: node scripts/check-client-secrets.mjs <source|dist>')
  process.exit(2)
}

const root = process.cwd()
const binaryExtensions = new Set([
  '.avi', '.gif', '.ico', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf',
  '.png', '.pptx', '.woff', '.woff2', '.xlsx', '.zip',
])

function listTextFiles(path) {
  if (!existsSync(path)) return []
  const stats = statSync(path)
  if (stats.isFile()) return binaryExtensions.has(extname(path).toLowerCase()) ? [] : [path]
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    listTextFiles(join(path, entry.name))
  )
}

function decodeJwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role || null
  } catch {
    return null
  }
}

const sourceTargets = [
  'src',
  'index.html',
  'vite.config.js',
  '.env',
  '.env.local',
  '.env.production',
  '.env.example',
]
const targets = mode === 'source' ? sourceTargets : ['dist']
const files = targets.flatMap(target => listTextFiles(resolve(root, target)))

if (mode === 'dist' && files.length === 0) {
  console.error('Client secret check failed: dist is missing or empty')
  process.exit(1)
}

const findings = []
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  const displayPath = relative(root, file)

  if (/VITE_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET_KEY)/.test(content)) {
    findings.push({ file: displayPath, type: 'browser-exposed privileged environment variable' })
  }
  if (/sb_secret_[A-Za-z0-9_-]+/.test(content)) {
    findings.push({ file: displayPath, type: 'Supabase secret key' })
  }

  const jwtTokens = content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []
  if (jwtTokens.some(token => decodeJwtRole(token) === 'service_role')) {
    findings.push({ file: displayPath, type: 'Supabase service_role JWT' })
  }
}

if (findings.length > 0) {
  console.error(`Client secret check failed (${mode}). Secret values are intentionally hidden:`)
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.type}`)
  process.exit(1)
}

console.log(`Client secret check passed (${mode}): ${files.length} files scanned`)
