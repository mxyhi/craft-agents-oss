#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — verifies static i18n callsites resolve in en.json.
 *
 * Scope is intentionally narrow: scan source files for literal `t(...)`,
 * `i18n.t(...)`, and `<Trans i18nKey=...>` keys. Dynamic keys are skipped
 * because they depend on runtime data and are covered by i18next warnings.
 */

import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const EN_LOCALE_PATH = join(REPO_ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', 'en.json')
const SCAN_ROOTS = ['apps', 'packages'].map(root => join(REPO_ROOT, root))
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'release', '.turbo'])
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

interface KeyReference {
  key: string
  file: string
  line: number
}

const CALLSITE_PATTERNS: RegExp[] = [
  /\b(?:t|i18n\.t)\(\s*'((?:\\'|[^'])+)'/g,
  /\b(?:t|i18n\.t)\(\s*"((?:\\"|[^"])+)"/g,
  /\b(?:t|i18n\.t)\(\s*`((?:\\`|[^`$])+?)`/g,
  /<Trans\b[^>]*\bi18nKey\s*=\s*'((?:\\'|[^'])+)'/g,
  /<Trans\b[^>]*\bi18nKey\s*=\s*"((?:\\"|[^"])+)"/g,
  /<Trans\b[^>]*\bi18nKey\s*=\s*\{\s*'((?:\\'|[^'])+)'\s*\}/g,
  /<Trans\b[^>]*\bi18nKey\s*=\s*\{\s*"((?:\\"|[^"])+)"\s*\}/g,
]

function parseLocaleKeys(raw: string) {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('en.json must be a flat object')
  }

  return new Set(Object.keys(parsed))
}

function decodeLiteralKey(raw: string) {
  return raw.replace(/\\(['"`\\])/g, '$1')
}

function lineForOffset(source: string, offset: number) {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) line++
  }
  return line
}

function extractReferences(file: string, source: string): KeyReference[] {
  const references: KeyReference[] = []
  for (const pattern of CALLSITE_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      const key = match[1]
      if (!key) continue
      references.push({
        key: decodeLiteralKey(key),
        file,
        line: lineForOffset(source, match.index ?? 0),
      })
    }
  }
  return references
}

function hasLocaleKey(localeKeys: Set<string>, key: string) {
  if (localeKeys.has(key)) return true
  return PLURAL_SUFFIXES.some(suffix => localeKeys.has(`${key}_${suffix}`))
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      files.push(...await collectSourceFiles(path))
      continue
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path)
    }
  }

  return files
}

const enKeys = parseLocaleKeys(await readFile(EN_LOCALE_PATH, 'utf-8'))
const sourceFiles = (await Promise.all(SCAN_ROOTS.map(collectSourceFiles))).flat().sort()
const missing: KeyReference[] = []
let checkedReferences = 0

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf-8')
  for (const reference of extractReferences(relative(REPO_ROOT, file), source)) {
    checkedReferences++
    if (!hasLocaleKey(enKeys, reference.key)) missing.push(reference)
  }
}

if (missing.length) {
  console.error(`i18n coverage check failed: ${missing.length} missing key reference(s)`)
  for (const ref of missing.slice(0, 50)) {
    console.error(`  ${ref.file}:${ref.line} -> ${ref.key}`)
  }
  if (missing.length > 50) {
    console.error(`  ...and ${missing.length - 50} more`)
  }
  process.exit(1)
}

console.log(`i18n coverage OK (${checkedReferences} static references, ${enKeys.size} en keys)`)
