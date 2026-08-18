// dsh-backup: automated backup & restore engine for DeepSeek Harness.
//
// Host half of the dsh-backup plugin. Owns the durable backup state under
// D:\Program Files\harness\备份 (configurable via config.backupRoot), runs
// full + incremental backups, applies retention (2 fulls / 30 increments),
// and exposes HTTP routes consumed by the settings card in lib/client.js:
//
//   GET  /dsh-backup/status  -> current backup state + next scheduled check
//   POST /dsh-backup/backup  -> { type: 'incremental' | 'full' } run now
//   GET  /dsh-backup/history -> list of full & incremental backups
//   POST /dsh-backup/restore -> { backup: <path>, scope: 'memory' | 'config' }
//
// The restore surface NEVER writes .credentials.yaml or modlens-config.json:
// API keys are structurally excluded from restore (and from config-scope
// backups) so a shared backup can never leak another user's keys.
//
// Triggers:
//   1. on startup (after webServer is available)
//   2. on session/ended events (incremental for that session's project)
//   3. every 6h via setInterval (full when the month rolled over, else incremental)
//
// Fully dependency-free (node builtins only) and failure-contained: every
// background path catches and logs; it never throws into the dsh boot.

import { promises as fs } from 'node:fs'
import { existsSync, createReadStream, createWriteStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
// Register a settings namespace so the backup card appears in the Plugins →
// Plugin Configuration list (the tab only renders cards for namespaces the
// host serves). The card's own config still lives in 备份工作目录/config.json;
// this namespace is a presence marker, not a second config source.
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-backup'
export const inject = ['sessions']

const HERE = dirname(fileURLToPath(import.meta.url))
// The web profile's own node_modules root (where this plugin lives).
const PROFILE_NM = join(HERE, '..', '..')
// Resolve the harness data root: $DSH_HOME or the profile's parent "dsh-data".
function resolveDataRoot() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(PROFILE_NM, '..') // .../profiles/web/node_modules -> .../profiles -> wait
}
// profiles/web/node_modules -> up to harness root: ../.. gives profiles,
// ../../.. gives the data root's parent (harness), then dsh-data.
const DATA_ROOT = process.env.DSH_HOME || join(dirname(dirname(dirname(PROFILE_NM))), 'dsh-data')

const DEFAULT_BACKUP_ROOT = 'D:\\Program Files\\harness\\备份'
const FULL_RETENTION = 2
const INCREMENT_RETENTION = 30
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h
const DAY_MS = 24 * 60 * 60 * 1000

// Load persisted user config from <backupRoot>/备份工作目录/config.json.
// Returns {} when missing/corrupt; never throws.
function loadPersistedConfig(backupRoot) {
  try {
    const p = join(backupRoot, '备份工作目录', 'config.json')
    if (!existsSync(p)) return {}
    const raw = readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    return (j && typeof j === 'object') ? j : {}
  } catch {
    return {}
  }
}

// Persist user config; never throws.
function savePersistedConfig(backupRoot, cfg) {
  try {
    const dir = join(backupRoot, '备份工作目录')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

// Files that must NEVER be restored (API keys / identity).
const NEVER_RESTORE = new Set([
  '.credentials.yaml',
  'modlens-config.json',
  'config.json', // modlens engine config inside modlens dirs
])
// Files that are excluded from "config"-scope backups too (keys never leave).
const NEVER_BACKUP_KEYS = new Set(['.credentials.yaml', 'modlens-config.json', 'config.json'])

// Plugin bodies: user-installed plugins live in the web profile's node_modules,
// listed in package.json's dependencies. Official @deepseek-ai bundles and
// transitive deps are excluded — they can be reinstalled from npm.
const HOSTED_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
// Files never copied into plugin-body backups (identity / keys / noise).
const PLUGIN_SKIP = new Set(['.bin', '.cache', 'node_modules', '.git', 'dist'])

export function apply(ctx, config = {}) {
  log('apply called, inject services:', JSON.stringify(config))
  // Load persisted user config from <default backupRoot>/备份工作目录/config.json.
  // The persisted file wins over patch config so the settings card is the
  // source of truth once the user edits it; patch values act as defaults.
  const defaultRoot = config.backupRoot || DEFAULT_BACKUP_ROOT
  const persisted = loadPersistedConfig(defaultRoot)
  const backupRoot = persisted.backupRoot || defaultRoot
  const fullRetention = persisted.fullRetention ?? config.fullRetention ?? FULL_RETENTION
  const incrementRetention = persisted.incrementRetention ?? config.incrementRetention ?? INCREMENT_RETENTION
  const fullIntervalHours = persisted.fullIntervalHours ?? config.fullIntervalHours ?? 720   // 720h = monthly
  const incrementIntervalHours = persisted.incrementIntervalHours ?? config.incrementIntervalHours ?? 24 // 24h = daily

  // ---- state --------------------------------------------------------------
  const state = {
    lastFull: null,      // { ts, dir }
    lastIncremental: null,
    nextCheck: null,
    running: false,
    lastError: null,
  }

  const engine = createEngine({
    backupRoot, fullRetention, incrementRetention,
    fullIntervalHours, incrementIntervalHours, state,
  })

  // ---- triggers -----------------------------------------------------------
  // 1. startup: schedule an immediate catch-up backup, then the 6h loop.
  //    Runs after webServer is present so the card can refresh.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        const ws = scope?.webServer || scope
        if (ws && typeof ws.register === 'function') {
          log('webServer ready, registering routes')
          engine.registerRoutes(ws, engine)
        } else {
          log('webServer scope has no register, keys:', scope ? Object.keys(scope).slice(0,12).join(',') : 'null')
        }
      } catch (e) {
        log('route registration failed:', e?.message ?? e)
      }
    })
    // Register a settings namespace so the backup card appears in the
    // Plugins → Plugin Configuration list (presence marker only; the card's
    // config stays in 备份工作目录/config.json).
    try {
      installSettingsSection(ctx, settingsNamespace('dsh-backup'), z.object({}), {}, { setSource: () => {}, onChange: () => {} })
      log('settings namespace registered: dsh-backup')
    } catch (e) {
      log('settings namespace registration failed:', e?.message ?? e)
    }
  } else {
    log('no ctx.inject; routes skipped')
  }
  // startup catch-up + timer run regardless of routes.
  // Check frequency: half the increment interval, clamped to [1min, 6h].
  let timer = null
  function startTimer() {
    if (timer) clearInterval(timer)
    const incHours = engine.getConfig().incrementIntervalHours ?? 24
    const checkMs = Math.min(6 * 60 * 60 * 1000, Math.max(60 * 1000, incHours * 60 * 60 * 1000 / 2))
    engine.startupCheck().catch((e) => log('startup check failed', e))
    state.nextCheck = Date.now() + checkMs
    timer = setInterval(() => {
      state.nextCheck = Date.now() + checkMs
      engine.timedCheck().catch((e) => log('timed check failed', e))
    }, checkMs)
    timer.unref?.()
  }
  startTimer()
  // hot reload hook: setConfig() calls this to restart the timer with new intervals
  engine.setOnConfigChange(startTimer)

  // 2. session ended -> incremental backup for that session's project.
  if (typeof ctx.on === 'function') {
    ctx.on('session/ended', async (payload) => {
      try {
        const sessionId = payload?.sessionId || payload?.id
        if (!sessionId) return
        await engine.backupSession(sessionId, 'incremental')
      } catch (e) {
        log(`session/ended backup failed: ${e?.message ?? e}`)
      }
    })
  }

  // ---- teardown -----------------------------------------------------------
  return () => {
    // timers are unref'd; nothing to tear down explicitly.
  }
}

// --------------------------------------------------------------------------
// engine
// --------------------------------------------------------------------------
function createEngine({ backupRoot, fullRetention, incrementRetention, fullIntervalHours, incrementIntervalHours, state }) {
  // Mutable config: reconfigure() swaps these live (hot reload) so the
  // settings card takes effect without a restart.
  let cfg = {
    backupRoot,
    fullRetention,
    incrementRetention,
    fullIntervalHours: fullIntervalHours ?? 720,
    incrementIntervalHours: incrementIntervalHours ?? 24,
  }
  const FULL_DIR = () => join(cfg.backupRoot, '全量备份')
  const INC_DIR = () => join(cfg.backupRoot, '增量备份')
  const WORK_DIR = () => join(cfg.backupRoot, '备份工作目录')
  const CUR_DIR = () => join(WORK_DIR(), '当前状态')
  const MEM_DIR = () => join(WORK_DIR(), '记忆归档')
  const FULL_INTERVAL_MS = () => cfg.fullIntervalHours * 60 * 60 * 1000
  const INC_INTERVAL_MS = () => cfg.incrementIntervalHours * 60 * 60 * 1000

  // Hot-reload: swap live config. Returns the new effective config.
  let onConfigChange = null
  function setOnConfigChange(fn) { onConfigChange = fn }
  function reconfigure(next) {
    const merged = Object.assign({}, cfg, next || {})
    // guard ranges
    merged.fullIntervalHours = clampNum(merged.fullIntervalHours, 1, 24 * 90, 720)
    merged.incrementIntervalHours = clampNum(merged.incrementIntervalHours, 1, 24 * 90, 24)
    merged.fullRetention = clampNum(merged.fullRetention, 1, 10, 2)
    merged.incrementRetention = clampNum(merged.incrementRetention, 1, 365, 30)
    if (typeof merged.backupRoot !== 'string' || !merged.backupRoot.trim()) merged.backupRoot = backupRoot
    cfg = merged
    log('reconfigured:', JSON.stringify(cfg))
    try { onConfigChange?.() } catch (e) { log('onConfigChange failed:', e?.message ?? e) }
    return Object.assign({}, cfg)
  }

  function clampNum(v, min, max, dflt) {
    const n = Number(v)
    if (!Number.isFinite(n)) return dflt
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  async function ensureDirs() {
    await fs.mkdir(FULL_DIR(), { recursive: true })
    await fs.mkdir(INC_DIR(), { recursive: true })
    await fs.mkdir(WORK_DIR(), { recursive: true })
    await fs.mkdir(CUR_DIR(), { recursive: true })
  }

  function stamp() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    // filesystem-safe: no colons (Windows forbids ':' in names)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }

  function isSameMonth(a, b) {
    const da = new Date(a), db = new Date(b)
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()
  }

  // Copy one file, skipping never-backup keys; returns true if copied.
  async function copyFile(src, dst, skipKeys = false) {
    if (skipKeys && NEVER_BACKUP_KEYS.has(basename(src))) return false
    await fs.mkdir(dirname(dst), { recursive: true })
    await fs.copyFile(src, dst)
    return true
  }

  // Recursively copy a directory tree (sessions, storages, memory archive).
  async function copyTree(src, dst, opts = {}) {
    if (!existsSync(src)) return 0
    let count = 0
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      const s = join(src, e.name)
      const d = join(dst, e.name)
      if (e.isDirectory()) {
        if (opts.excludeDirs?.has(e.name)) continue
        count += await copyTree(s, d, opts)
      } else {
        if (opts.onlyNewerThan) {
          const st = await fs.stat(s).catch(() => null)
          if (st && st.mtimeMs < opts.onlyNewerThan) continue
        }
        if (await copyFile(s, d, opts.skipKeys)) count++
      }
    }
    return count
  }

  // ---- user-installed plugins ---------------------------------------------
  // Enumerate the plugins the user actually installed (package.json
  // dependencies minus the official host bundles). Returns [{ name, dir }].
  function userPlugins() {
    const webProfile = join(DATA_ROOT, 'profiles', 'web')
    const pjPath = join(webProfile, 'package.json')
    if (!existsSync(pjPath)) return []
    try {
      const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
      const deps = pj?.dependencies && typeof pj.dependencies === 'object' ? pj.dependencies : {}
      const out = []
      for (const name of Object.keys(deps)) {
        if (HOSTED_BUNDLES.has(name)) continue
        const dir = join(webProfile, 'node_modules', name)
        if (existsSync(dir)) out.push({ name, dir })
      }
      return out
    } catch {
      return []
    }
  }

  // Copy the user-installed plugin bodies into <dst>/插件本体/<name>/.
  // Skips identity/key files and heavy noise dirs; returns {name, files}[].
  // The per-plugin dir is always created (even with 0 changed files) so the
  // backup reliably reflects which plugins were installed at backup time.
  async function copyPluginBodies(dst, opts = {}) {
    const out = []
    for (const p of userPlugins()) {
      const target = join(dst, '插件本体', p.name)
      await fs.mkdir(target, { recursive: true })
      const count = await copyTree(p.dir, target, {
        onlyNewerThan: opts.onlyNewerThan,
        skipKeys: true,
        excludeDirs: PLUGIN_SKIP,
      })
      out.push({ name: p.name, files: count })
    }
    return out
  }

  // ---- user-installed skills ----------------------------------------------
  // Skills live outside node_modules, under $DSH_HOME/skills/<name>/ (e.g. the
  // ponytail set). Copy them into <dst>/技能/<name>/.
  function skillsRoot() {
    return join(DATA_ROOT, 'skills')
  }

  async function copySkills(dst, opts = {}) {
    const src = skillsRoot()
    if (!existsSync(src)) return { skills: [], files: 0 }
    let files = 0
    const names = []
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      names.push(e.name)
      const target = join(dst, '技能', e.name)
      await fs.mkdir(target, { recursive: true })
      files += await copyTree(join(src, e.name), target, {
        onlyNewerThan: opts.onlyNewerThan,
        skipKeys: true,
        excludeDirs: PLUGIN_SKIP,
      })
    }
    return { skills: names, files }
  }

  // Restore skills from <backupPath>/技能 back into $DSH_HOME/skills.
  async function restoreSkills(backupPath) {
    const src = join(backupPath, '技能')
    if (!existsSync(src)) return { restored: [], skipped: [] }
    const dstRoot = skillsRoot()
    const restored = []
    const skipped = []
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const d = join(dstRoot, e.name)
      await copyTree(join(src, e.name), d, { skipKeys: true, excludeDirs: PLUGIN_SKIP })
      restored.push(e.name)
    }
    return { restored, skipped }
  }

  // Restore plugin bodies from <backupPath>/插件本体 back into the web
  // profile's node_modules. Never overwrites keys (handled by skipKeys).
  async function restorePluginBodies(backupPath) {
    const src = join(backupPath, '插件本体')
    if (!existsSync(src)) return { restored: [], skipped: [] }
    const webProfile = join(DATA_ROOT, 'profiles', 'web')
    const restored = []
    const skipped = []
    const entries = await fs.readdir(src, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const s = join(src, e.name)
      const d = join(webProfile, 'node_modules', e.name)
      // only restore plugins the profile actually declares
      if (!userPlugins().some((p) => p.name === e.name)) {
        skipped.push(e.name)
        continue
      }
      await copyTree(s, d, { skipKeys: true, excludeDirs: PLUGIN_SKIP })
      restored.push(e.name)
    }
    return { restored, skipped }
  }

  // ---- full backup --------------------------------------------------------
  async function runFull() {
    await ensureDirs()
    const ts = stamp()
    const dir = join(FULL_DIR(), `${ts}-全量`)
    await fs.mkdir(dir, { recursive: true })

    // sessions (all projects, complete)
    const sessSrc = join(DATA_ROOT, 'sessions')
    await copyTree(sessSrc, join(dir, '会话'))
    // storages
    await copyTree(join(DATA_ROOT, 'storages'), join(dir, 'storages'))
    // core config (settings only — credentials excluded)
    for (const f of ['settings.yaml', '.anonymous-user-id']) {
      const s = join(DATA_ROOT, f)
      if (existsSync(s)) await copyFile(s, join(dir, '配置', f), true)
    }
    // plugin manifest (web profile package.json etc.)
    const webProfile = join(DATA_ROOT, 'profiles', 'web')
    for (const f of ['package.json', 'cordis.yml', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml']) {
      const s = join(webProfile, f)
      if (existsSync(s)) await copyFile(s, join(dir, '插件配置', `web-${f}`), true)
    }
    // plugin bodies (user-installed plugins: code + their own config)
    const pluginBodies = await copyPluginBodies(dir)
    // user-installed skills (e.g. ponytail set)
    const skills = await copySkills(dir)
    // memory archive (human-readable + session files)
    await copyTree(MEM_DIR(), join(dir, '记忆归档'))
    // regenerate memory archive from live sessions (fresh snapshot)
    await refreshMemoryArchive(MEM_DIR())
    await copyTree(MEM_DIR(), join(dir, '记忆归档'))

    // manifest
    const manifest = {
      type: 'full',
      ts,
      createdAt: new Date().toISOString(),
      dataRoot: DATA_ROOT,
      sessionCount: await countFiles(join(dir, '会话')),
      sizeBytes: await dirSize(dir),
      plugins: pluginBodies,
      skills,
    }
    await fs.writeFile(join(dir, '备份清单.json'), JSON.stringify(manifest, null, 2), 'utf8')

    state.lastFull = { ts, dir, time: Date.now() }
    await applyRetention()
    await refreshCurrentState(dir)
    return manifest
  }

  // ---- incremental backup -------------------------------------------------
  async function runIncremental(scope) {
    await ensureDirs()
    const ts = stamp()
    const dir = join(INC_DIR(), `${ts}-增量`)
    await fs.mkdir(dir, { recursive: true })

    // Reference point: newest existing full or incremental before now.
    const refTime = await lastBackupTime()
    const cutoff = refTime ? refTime : 0

    let sessionCount = 0
    const sessSrc = join(DATA_ROOT, 'sessions')
    if (existsSync(sessSrc)) {
      const projects = await fs.readdir(sessSrc, { withFileTypes: true })
      for (const p of projects) {
        if (!p.isDirectory()) continue
        const pSrc = join(sessSrc, p.name)
        const pDst = join(dir, '会话', p.name)
        // copy only session files newer than cutoff (incremental)
        const entries = await fs.readdir(pSrc, { withFileTypes: true })
        for (const se of entries) {
          const sPath = join(pSrc, se.name)
          const dPath = join(pDst, se.name)
          if (se.isDirectory()) {
            const f = join(sPath, 'session.jsonl.zstd')
            if (existsSync(f)) {
              const st = await fs.stat(f).catch(() => null)
              if (st && st.mtimeMs >= cutoff) {
                await fs.mkdir(dPath, { recursive: true })
                await fs.copyFile(f, join(dPath, 'session.jsonl.zstd'))
                sessionCount++
              }
            }
          }
        }
      }
    }

    // storages (changed only)
    await copyTree(join(DATA_ROOT, 'storages'), join(dir, 'storages'), { onlyNewerThan: cutoff })
    // settings.yaml if changed
    const settings = join(DATA_ROOT, 'settings.yaml')
    if (existsSync(settings)) {
      const st = await fs.stat(settings).catch(() => null)
      if (st && st.mtimeMs >= cutoff) await copyFile(settings, join(dir, '配置', 'settings.yaml'), true)
    }
    // plugin bodies (changed files only)
    const pluginBodies = await copyPluginBodies(dir, { onlyNewerThan: cutoff })
    // user-installed skills (changed files only)
    const skills = await copySkills(dir, { onlyNewerThan: cutoff })
    // memory archive: always refresh for the touched projects
    await refreshMemoryArchive(MEM_DIR(), scope)
    await copyTree(MEM_DIR(), join(dir, '记忆归档'), { onlyNewerThan: cutoff })

    const manifest = {
      type: 'incremental',
      ts,
      createdAt: new Date().toISOString(),
      refTime: refTime ? new Date(refTime).toISOString() : null,
      sessionCount,
      sizeBytes: await dirSize(dir),
      plugins: pluginBodies,
      skills,
    }
    await fs.writeFile(join(dir, '变更记录.json'), JSON.stringify(manifest, null, 2), 'utf8')

    state.lastIncremental = { ts, dir, time: Date.now() }
    await applyRetention()
    await refreshCurrentState(dir)
    return manifest
  }

  // ---- session-scoped incremental (session/ended) -------------------------
  async function backupSession(sessionId, kind) {
    // map session id -> its project dir name
    const sessSrc = join(DATA_ROOT, 'sessions')
    if (!existsSync(sessSrc)) return
    const projects = await fs.readdir(sessSrc, { withFileTypes: true })
    for (const p of projects) {
      if (!p.isDirectory()) continue
      const dir = join(sessSrc, p.name, sessionId)
      if (existsSync(dir)) {
        // a light touch: copy just this session into the current incremental
        return runIncrementalWithSession(sessionId, p.name)
      }
    }
  }

  async function runIncrementalWithSession(sessionId, projectName) {
    await ensureDirs()
    const ts = stamp()
    const dir = join(INC_DIR(), `${ts}-增量`)
    await fs.mkdir(dir, { recursive: true })
    const refTime = await lastBackupTime()
    const cutoff = refTime ? refTime : 0

    // copy just this session file
    const f = join(DATA_ROOT, 'sessions', projectName, sessionId, 'session.jsonl.zstd')
    if (existsSync(f)) {
      const st = await fs.stat(f).catch(() => null)
      if (st && st.mtimeMs >= cutoff) {
        await fs.mkdir(join(dir, '会话', projectName, sessionId), { recursive: true })
        await fs.copyFile(f, join(dir, '会话', projectName, sessionId, 'session.jsonl.zstd'))
      }
    }
    // refresh memory for the project
    await refreshMemoryArchive(MEM_DIR(), projectName)

    const manifest = {
      type: 'incremental',
      ts,
      createdAt: new Date().toISOString(),
      session: sessionId,
      project: projectName,
      sizeBytes: await dirSize(dir),
    }
    await fs.writeFile(join(dir, '变更记录.json'), JSON.stringify(manifest, null, 2), 'utf8')
    state.lastIncremental = { ts, dir, time: Date.now() }
    await applyRetention()
    await refreshCurrentState(dir)
    return manifest
  }

  // ---- retention ----------------------------------------------------------
  async function applyRetention() {
    // fulls: keep newest N
    const fulls = await listDirs(FULL_DIR(), '全量')
    while (fulls.length > fullRetention) {
      const oldest = fulls.shift()
      await fs.rm(join(FULL_DIR(), oldest), { recursive: true, force: true })
      log(`retention: removed full ${oldest}`)
    }
    // increments: keep newest N
    const incs = await listDirs(INC_DIR(), '增量')
    while (incs.length > incrementRetention) {
      const oldest = incs.shift()
      await fs.rm(join(INC_DIR(), oldest), { recursive: true, force: true })
      log(`retention: removed incremental ${oldest}`)
    }
  }

  async function listDirs(root, suffix) {
    if (!existsSync(root)) return []
    const all = await fs.readdir(root, { withFileTypes: true })
    const dirs = all.filter((e) => e.isDirectory() && e.name.includes(suffix)).map((e) => e.name)
    dirs.sort() // timestamp prefix sorts chronologically
    return dirs
  }

  // newest backup dir mtime (full or incremental)
  async function lastBackupTime() {
    let latest = 0
    for (const root of [FULL_DIR(), INC_DIR()]) {
      const dirs = await listDirs(root, '')
      for (const d of dirs) {
        const st = await fs.stat(join(root, d)).catch(() => null)
        if (st && st.mtimeMs > latest) latest = st.mtimeMs
      }
    }
    return latest || null
  }

  // ---- memory archive refresh ---------------------------------------------
  // Regenerates 记忆归档\<项目>\记忆.md from the live session logs. For the
  // scope project only when given (incremental), or all projects when not.
  async function refreshMemoryArchive(memRoot, scope) {
    // Full human-readable memory: for each project with sessions, write a
    // 记忆.md that captures the complete chronological timeline — session
    // title, every user message (verbatim, unfiltered except system noise),
    // and key tool calls (file writes, env changes, moves, installs). The
    // raw session files are copied alongside so dsh can fully restore.
    await fs.mkdir(memRoot, { recursive: true })
    const sessSrc = join(DATA_ROOT, 'sessions')
    if (!existsSync(sessSrc)) return
    const projects = await fs.readdir(sessSrc, { withFileTypes: true })
    for (const p of projects) {
      if (!p.isDirectory()) continue
      if (scope && p.name !== scope) continue
      const projMem = join(memRoot, projectLabel(p.name))
      await fs.mkdir(projMem, { recursive: true })
      const pSrc = join(sessSrc, p.name)
      const entries = await fs.readdir(pSrc, { withFileTypes: true })
      let lines = [`# 记忆：${projectLabel(p.name)}`, '', `> 自动生成于 ${new Date().toLocaleString('zh-CN')}`, '']
      for (const se of entries) {
        if (!se.isDirectory()) continue
        const f = join(pSrc, se.name, 'session.jsonl.zstd')
        if (!existsSync(f)) continue
        // copy raw file (dsh-restorable)
        await fs.mkdir(join(projMem, '会话文件'), { recursive: true })
        await fs.copyFile(f, join(projMem, '会话文件', `${se.name}.jsonl.zstd`))
        // full chronological timeline
        const timeline = await extractTimeline(f)
        lines.push(`## 会话 ${se.name}`, '')
        if (timeline.title) lines.push(`**标题**：${timeline.title}`, '')
        if (timeline.items.length === 0) {
          lines.push('（无对话内容）', '')
        } else {
          for (const item of timeline.items) {
            lines.push(item, '')
          }
        }
      }
      await fs.writeFile(join(projMem, '记忆.md'), lines.join('\n'), 'utf8')
    }
  }

  async function extractTimeline(zstdPath) {
    try {
      const buf = await fs.readFile(zstdPath)
      let text = ''
      try { text = await decompressAll(buf) } catch { text = '' }
      if (!text) return { title: null, items: [] }

      const events = []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const j = JSON.parse(line)
          events.push({ seq: j.seq ?? 0, type: j.type, data: j.data })
        } catch {}
      }
      events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

      let title = null
      const items = []
      const seenUser = new Set()

      for (const e of events) {
        try {
          switch (e.type) {
            case 'session/title':
            case 'session/title-updated': {
              if (e.data?.title) title = e.data.title
              break
            }
            case 'user/message': {
              const c = e.data?.content
              let t = ''
              if (Array.isArray(c)) t = c.map((p) => p.text || '').join(' ').trim()
              else if (typeof c === 'string') t = c.trim()
              if (!t) break
              // skip system-injected noise, keep everything else verbatim
              if (/system-reminder|Current runtime context|goal_round|<goal|<system-reminder>/i.test(t)) break
              if (/^The approval policy changed/i.test(t)) break
              if (/^<system-reminder>/i.test(t)) break
              // dedupe: identical consecutive user messages collapse
              const key = t
              if (seenUser.has(key)) break
              seenUser.add(key)
              items.push(`**用户**：${t}`)
              break
            }
            case 'tool/call': {
              const name = e.data?.name
              const args = e.data?.arguments
              if (!name) break
              const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? '')
              // only key actions: writes, env, moves, installs, backups
              if (/^write$|^edit$|^pwsh$/.test(name) && /write|SetEnvironmentVariable|Move-Item|Remove-Item|Copy-Item|robocopy|npm|pnpm|plugin|junction|dsh-backup|backup/i.test(argsStr)) {
                let snippet = argsStr.slice(0, 220)
                items.push(`**操作**（${name}）：${snippet}`)
              }
              break
            }
          }
        } catch {}
      }
      return { title, items }
    } catch {
      return { title: null, items: [] }
    }
  }

  // ---- helpers ------------------------------------------------------------
  async function decompressAll(buf) {
    const zlib = await import('node:zlib')
    // node zlib zstdDecompressSync handles one complete frame; multi-frame
    // files need frame splitting — reuse a minimal splitter.
    const magic = 0xfd2fb528
    const frames = []
    let o = 0
    while (o + 4 <= buf.length && buf.readUInt32LE(o) === magic) {
      const start = o
      o += 4
      if (o >= buf.length) break
      const d = buf.readUInt8(o)
      o += 1
      const csf = d >>> 6
      const ss = (d & 32) !== 0
      const ck = (d & 4) !== 0
      const df = d & 3
      const db = df === 3 ? 4 : df
      const cb = csf === 0 ? (ss ? 1 : 0) : 1 << csf
      const rh = (ss ? 0 : 1) + db + cb
      if (o + rh > buf.length) break
      o += rh
      for (;;) {
        if (o + 3 > buf.length) break
        const bh = buf.readUIntLE(o, 3)
        o += 3
        const lb = (bh & 1) !== 0
        const bt = (bh >>> 1) & 3
        const bs = bh >>> 3
        if (bt === 3) break
        const pb = bt === 1 ? 1 : bs
        if (o + pb > buf.length) break
        o += pb
        if (lb) break
      }
      if (ck) { if (o + 4 > buf.length) break; o += 4 }
      frames.push(buf.subarray(start, o))
    }
    if (frames.length === 0) return ''
    const parts = []
    for (const f of frames) {
      try { parts.push(zlib.zstdDecompressSync(f)) } catch {}
    }
    return Buffer.concat(parts).toString('utf8')
  }

  async function countFiles(dir) {
    if (!existsSync(dir)) return 0
    let n = 0
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += await countFiles(join(dir, e.name))
      else n++
    }
    return n
  }

  async function dirSize(dir) {
    if (!existsSync(dir)) return 0
    let s = 0
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) s += await dirSize(p)
      else s += (await fs.stat(p).catch(() => ({ size: 0 }))).size
    }
    return s
  }

  async function refreshCurrentState(fromDir) {
    // mirror the latest backup into 当前状态 for human browsing
    try {
      await fs.rm(CUR_DIR(), { recursive: true, force: true })
      await fs.mkdir(CUR_DIR(), { recursive: true })
      await copyTree(fromDir, CUR_DIR())
    } catch (e) {
      log(`refreshCurrentState failed: ${e?.message ?? e}`)
    }
  }

  // ---- startup / timed checks --------------------------------------------
  async function startupCheck() {
    await decideBackup()
  }

  async function timedCheck() {
    await decideBackup()
  }

  // Decide what to run: full when the last FULL is older than fullInterval,
  // else incremental when any backup is older than incrementInterval.
  async function decideBackup() {
    const lastFullMs = await lastFullTime()
    const lastAnyMs = await lastBackupTime()
    const now = Date.now()
    const fullDue = !lastFullMs || (now - lastFullMs >= FULL_INTERVAL_MS())
    const incDue = !lastAnyMs || (now - lastAnyMs >= INC_INTERVAL_MS())
    if (fullDue) {
      await runFull()
    } else if (incDue) {
      await runIncremental()
    }
  }

  // mtime of the newest full backup dir, else 0.
  async function lastFullTime() {
    let latest = 0
    const fulls = await listDirs(FULL_DIR(), '全量')
    for (const d of fulls) {
      const st = await fs.stat(join(FULL_DIR(), d)).catch(() => null)
      if (st && st.mtimeMs > latest) latest = st.mtimeMs
    }
    return latest
  }

  // ---- status / history ---------------------------------------------------
  async function status() {
    const last = await lastBackupTime()
    const fulls = await listDirs(FULL_DIR(), '全量')
    const incs = await listDirs(INC_DIR(), '增量')
    const lastFullMs = await lastFullTime()
    return {
      ok: true,
      backupRoot: cfg.backupRoot,
      lastBackup: last ? new Date(last).toISOString() : null,
      lastFull: lastFullMs ? new Date(lastFullMs).toISOString() : null,
      lastIncremental: state.lastIncremental ? new Date(state.lastIncremental.time).toISOString() : null,
      nextCheck: state.nextCheck ? new Date(state.nextCheck).toISOString() : null,
      fullCount: fulls.length,
      incrementalCount: incs.length,
      running: state.running,
      lastError: state.lastError,
    }
  }

  async function history() {
    const fulls = (await listDirs(FULL_DIR(), '全量')).map((d) => ({
      type: 'full', dir: d, path: join(FULL_DIR(), d),
    }))
    const incs = (await listDirs(INC_DIR(), '增量')).map((d) => ({
      type: 'incremental', dir: d, path: join(INC_DIR(), d),
    }))
    return { fulls, increments: incs }
  }

  // ---- restore ------------------------------------------------------------
  // scope: 'memory' (sessions + memory archive) | 'config' (settings.yaml only).
  // NEVER touches .credentials.yaml / modlens-config.json / config.json.
  async function restore(backupPath, scope) {
    if (!backupPath || !existsSync(backupPath)) {
      throw new Error('备份路径不存在')
    }
    if (state.running) throw new Error('备份正在进行中，请稍后再试')

    // safety snapshot of current state before restoring
    await ensureDirs()
    const ts = stamp()
    const snapDir = join(backupRoot, '还原前快照', `${ts}-还原前`)
    await fs.mkdir(snapDir, { recursive: true })
    await copyTree(join(DATA_ROOT, 'sessions'), join(snapDir, 'sessions'))
    await copyTree(join(DATA_ROOT, 'storages'), join(snapDir, 'storages'))

    const restored = { sessions: 0, config: [] }

    if (scope === 'memory' || scope === 'all') {
      const src = join(backupPath, '会话')
      if (existsSync(src)) {
        // merge session files into data root sessions (by project dir)
        const projects = await fs.readdir(src, { withFileTypes: true })
        for (const p of projects) {
          if (!p.isDirectory()) continue
          const pSrc = join(src, p.name)
          const pDst = join(DATA_ROOT, 'sessions', p.name)
          await fs.mkdir(pDst, { recursive: true })
          const sessions = await fs.readdir(pSrc, { withFileTypes: true })
          for (const s of sessions) {
            if (!s.isDirectory()) continue
            const f = join(pSrc, s.name, 'session.jsonl.zstd')
            if (existsSync(f)) {
              await fs.mkdir(join(pDst, s.name), { recursive: true })
              await fs.copyFile(f, join(pDst, s.name, 'session.jsonl.zstd'))
              restored.sessions++
            }
          }
        }
      }
      // restore storages too (workspace registry / projection cache) — the
      // session registry lives there; keys are not in storages.
      const st = join(backupPath, 'storages')
      if (existsSync(st)) await copyTree(st, join(DATA_ROOT, 'storages'))
    }

    if (scope === 'config' || scope === 'all') {
      const cfg = join(backupPath, '配置')
      if (existsSync(cfg)) {
        for (const f of await fs.readdir(cfg, { withFileTypes: true })) {
          if (!f.isFile()) continue
          if (NEVER_RESTORE.has(f.name)) continue // never touch keys
          await copyFile(join(cfg, f.name), join(DATA_ROOT, f.name), true)
          restored.config.push(f.name)
        }
      }
    }

    // plugin bodies (user-installed plugins) — only on explicit scope
    let plugins = null
    if (scope === 'plugins' || scope === 'all') {
      plugins = await restorePluginBodies(backupPath)
      restored.plugins = plugins.restored
      restored.pluginSkipped = plugins.skipped
      const skills = await restoreSkills(backupPath)
      restored.skills = skills.restored
      restored.skillsSkipped = skills.skipped
    }

    return {
      ok: true,
      scope,
      restored,
      safetySnapshot: snapDir,
      note: 'API key 文件（.credentials.yaml / modlens-config.json）永远不会被还原',
    }
  }

  // ---- routes -------------------------------------------------------------
  function registerRoutes(webServer, engine) {
    webServer.register({
      name: 'dsh-backup-status',
      kind: 'exact',
      path: '/dsh-backup/status',
      handler: async (req, res) => {
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) return send(403, { error: 'refused' })
        try { send(200, await engine.status()) } catch (e) { send(500, { error: String(e?.message ?? e) }) }
      },
    })
    webServer.register({
      name: 'dsh-backup-history',
      kind: 'exact',
      path: '/dsh-backup/history',
      handler: async (req, res) => {
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) return send(403, { error: 'refused' })
        try { send(200, await engine.history()) } catch (e) { send(500, { error: String(e?.message ?? e) }) }
      },
    })
    webServer.register({
      name: 'dsh-backup-config',
      kind: 'exact',
      path: '/dsh-backup/config',
      handler: async (req, res) => {
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) return send(403, { error: 'refused' })
        try {
          if (req.method === 'GET') {
            send(200, await engine.getConfig())
          } else if (req.method === 'POST') {
            const body = await readJson(req)
            send(200, await engine.setConfig(body))
          } else {
            send(405, { error: 'method not allowed' })
          }
        } catch (e) { send(500, { error: String(e?.message ?? e) }) }
      },
    })
    webServer.register({
      name: 'dsh-backup-backup',
      kind: 'exact',
      path: '/dsh-backup/backup',
      handler: async (req, res) => {
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) return send(403, { error: 'refused' })
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
        try {
          const body = await readJson(req)
          const type = body?.type === 'full' ? 'full' : 'incremental'
          if (state.running) return send(409, { error: '备份正在进行中' })
          state.running = true
          try {
            const r = type === 'full' ? await engine.runFull() : await engine.runIncremental()
            send(200, r)
          } finally {
            state.running = false
          }
        } catch (e) {
          state.lastError = String(e?.message ?? e)
          send(500, { error: state.lastError })
        }
      },
    })
    webServer.register({
      name: 'dsh-backup-restore',
      kind: 'exact',
      path: '/dsh-backup/restore',
      handler: async (req, res) => {
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (!isTrustedRequest(req)) return send(403, { error: 'refused' })
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
        try {
          const body = await readJson(req)
          const scope = body?.scope === 'config' ? 'config' : 'memory'
          const r = await engine.restore(body?.backup, scope)
          send(200, r)
        } catch (e) {
          send(500, { error: String(e?.message ?? e) })
        }
      },
    })
  }

  async function readJson(req) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  }

  // ---- config read / write (persisted to 备份工作目录/config.json) ----------
  async function getConfig() {
    return {
      ok: true,
      backupRoot: cfg.backupRoot,
      fullIntervalHours: cfg.fullIntervalHours,
      incrementIntervalHours: cfg.incrementIntervalHours,
      fullRetention: cfg.fullRetention,
      incrementRetention: cfg.incrementRetention,
      persisted: loadPersistedConfig(cfg.backupRoot),
    }
  }

  async function setConfig(body) {
    const cur = loadPersistedConfig(cfg.backupRoot)
    const next = {
      backupRoot: typeof body.backupRoot === 'string' && body.backupRoot.trim() ? body.backupRoot.trim() : cur.backupRoot || cfg.backupRoot,
      fullIntervalHours: num(body.fullIntervalHours, cur.fullIntervalHours ?? 720, 1, 24 * 90),
      incrementIntervalHours: num(body.incrementIntervalHours, cur.incrementIntervalHours ?? 24, 1, 24 * 90),
      fullRetention: num(body.fullRetention, cur.fullRetention ?? FULL_RETENTION, 1, 10),
      incrementRetention: num(body.incrementRetention, cur.incrementRetention ?? INCREMENT_RETENTION, 1, 365),
    }
    // persist to the (possibly new) backup root, then hot-reload live
    const saved = savePersistedConfig(next.backupRoot, next)
    const effective = reconfigure(next)
    return { ok: true, saved, config: effective, note: '已热重载生效（无需重启）' }
  }

  function num(v, dflt, min, max) {
    const n = Number(v)
    if (!Number.isFinite(n)) return dflt
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  return {
    runFull, runIncremental, backupSession, status, history, restore,
    startupCheck, timedCheck, registerRoutes, getConfig, setConfig, reconfigure, setOnConfigChange,
    _internal: { state },
  }
}

// ---- shared helpers -------------------------------------------------------
function isTrustedRequest(req) {
  // same-origin loopback check mirroring modlens: the Host header must be a
  // loopback authority.
  const host = req.headers.host || ''
  const [h] = host.split(':')
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

function projectLabel(key) {
  // map project key -> readable label
  const map = {
    '--D-Program~0020Files-harness-~9879~76EE-~76F8~5173--': '01-相关',
    '--D-Program~0020Files-harness-~9879~76EE-work--': '02-work',
    '--D-Program~0020Files-harness-~9879~76EE-Luna--': '03-Luna',
    '--D-Program~0020Files-harness-first--': '04-first',
    '--D-Program~0020Files-harness-work--': '02-work',
  }
  return map[key] || key
}

function log(...args) {
  console.log('[dsh-backup]', ...args)
}
