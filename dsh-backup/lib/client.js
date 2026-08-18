// dsh-backup: browser half — settings card with backup status, history,
// one-click backup, and guarded restore.
//
// Registered through `settings.plugin.item` (Plugins → Plugin Configuration,
// same list as dsh-restart; presence requires the host-side settings
// namespace `dsh-backup`). Talks to the host routes:
//   GET  /dsh-backup/status
//   GET  /dsh-backup/history
//   POST /dsh-backup/backup   { type }
//   POST /dsh-backup/restore  { backup, scope }
//
// Hand-written in the lazy-CJS bundle protocol, zero build step, no dsh
// client package imports (dependency-free, mirroring modlens). UI follows the
// aqua design language: injected <style> with --dsw-alias-* theme variables,
// group/subGroup/row layout, segmented controls.
window.__ModuleLoader__.load({
  id: '@wntediluvian/dsh-backup',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---- styles (aqua-style, injected once) -------------------------------
    var css = [
      '.dshbk_wrap{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}',
      '.dshbk_wrap:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dshbk_wrapOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dshbk_wrapHead{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
      '.dshbk_wrapHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.dshbk_wrapName{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.dshbk_wrapDesc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dshbk_wrapChevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.dshbk_wrapChevronOpen{transform:rotate(180deg)}',
      '.dshbk_wrapBody{border-top:1px solid var(--dsw-alias-border-l2);padding:0 16px 12px}',
      '.dshbk_wrapBody .dshbk_panel{border:none;background:0 0;padding:0;margin:0;box-shadow:none}',
      '.dshbk_panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;flex-direction:column;gap:0;padding:14px 16px;margin:4px 0 12px;display:flex}',
      '.dshbk_head{flex-direction:row;align-items:center;gap:8px;padding-bottom:10px;margin-bottom:4px;display:flex}',
      '.dshbk_icon{width:22px;height:22px;color:var(--dsw-alias-state-business-primary);flex:none;align-items:center;justify-content:center;display:inline-flex}',
      '.dshbk_headTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}',
      '.dshbk_headDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:2px}',
      '.dshbk_group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:10px 0 14px;display:flex}',
      '.dshbk_group:last-child{border-bottom:none}',
      '.dshbk_subTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}',
      '.dshbk_subGroup{flex-direction:column;gap:8px;display:flex}',
      '.dshbk_row{align-items:center;gap:10px;min-height:26px;display:flex}',
      '.dshbk_rowLabel{width:96px;color:var(--dsw-alias-label-secondary);flex:none;font-size:12px;line-height:18px}',
      '.dshbk_rowValue{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dshbk_rowHint{color:var(--dsw-alias-label-tertiary);margin-top:-4px;margin-left:106px;font-size:12px;line-height:18px}',
      '.dshbk_groupHint{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:12px;line-height:18px}',
      '.dshbk_badge{border:1px solid var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);border-radius:999px;padding:0 8px;font-size:11px;line-height:16px;display:inline-block}',
      '.dshbk_badgeBusy{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);border-radius:999px;padding:0 8px;font-size:11px;line-height:16px;display:inline-block}',
      '.dshbk_btnRow{flex-direction:row;align-items:center;gap:8px;display:flex}',
      '.dshbk_btn{border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:0 12px;font-size:12px;line-height:18px;display:inline-flex}',
      '.dshbk_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshbk_btn:disabled{opacity:.45;cursor:default}',
      '.dshbk_btnPrimary{border-color:#0000;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}',
      '.dshbk_btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshbk_btnDanger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshbk_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);height:28px;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:12px;line-height:18px}',
      '.dshbk_select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
      '.dshbk_msg{border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px}',
      '.dshbk_ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}',
      '.dshbk_err{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
      '.dshbk_segmented{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:inline-flex;overflow:hidden}',
      '.dshbk_seg,.dshbk_segActive{height:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0 10px;font-size:12px;line-height:18px}',
      '.dshbk_seg+.dshbk_seg,.dshbk_segActive+.dshbk_seg,.dshbk_seg+.dshbk_segActive{border-left:1px solid var(--dsw-alias-border-l2)}',
      '.dshbk_segActive{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}',
    ].join('')
    var cssTag = 'dsh-backup/styles'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-backup'
      tag.dataset.pluginCss = cssTag
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ---- helpers ----------------------------------------------------------
    function api(path, opts) {
      var options = opts || {}
      return fetch(path, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {} }).then(function (body) {
            var e = new Error(body.error || ('request failed (' + res.status + ')'))
            e.status = res.status
            throw e
          })
        }
        return res.json()
      })
    }

    function fmtTime(iso) {
      if (!iso) return '—'
      try {
        var d = new Date(iso)
        if (isNaN(d.getTime())) return String(iso)  // invalid date: show raw
        var p = function (n) { return String(n).padStart(2, '0') }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      } catch (e) { return iso }
    }

    // ---- card body --------------------------------------------------------
    var react = null
    function BackupCard(props) {
      var React = react || window.React
      var useState = React.useState
      var useEffect = React.useEffect
      var useRef = React.useRef

      function row(label, value) {
        return React.createElement('div', { className: 'dshbk_row' },
          React.createElement('span', { className: 'dshbk_rowLabel' }, label),
          React.createElement('span', { className: 'dshbk_rowValue' }, value))
      }

      var [status, setStatus] = useState(null)
      var [history, setHistory] = useState(null)
      var [config, setConfig] = useState(null)
      var [cfgDraft, setCfgDraft] = useState(null)
      var [busy, setBusy] = useState(false)
      var [restoreBusy, setRestoreBusy] = useState(false)
      var [selected, setSelected] = useState('')
      var [open, setOpen] = useState(false)
      var [scope, setScope] = useState('memory')
      var [message, setMessage] = useState(null)
      var [error, setError] = useState(null)
      var mounted = useRef(true)

      function refresh() {
        api('/dsh-backup/status').then(function (s) { if (mounted.current) setStatus(s) }).catch(function (e) { if (mounted.current) setError(String(e.message)) })
        api('/dsh-backup/history').then(function (h) { if (mounted.current) setHistory(h) }).catch(function () {})
        api('/dsh-backup/config').then(function (c) { if (mounted.current) { setConfig(c); setCfgDraft(c) } }).catch(function () {})
      }

      useEffect(function () {
        mounted.current = true
        refresh()
        var t = setInterval(refresh, 30000)
        return function () { mounted.current = false; clearInterval(t) }
      }, [])

      function runBackup(type) {
        setBusy(true); setMessage(null); setError(null)
        api('/dsh-backup/backup', { method: 'POST', body: { type: type } })
          .then(function (r) {
            setMessage('备份完成：' + (r.type === 'full' ? '全量' : '增量') + '（' + fmtTime(r.ts) + '，' + (r.sessionCount ?? 0) + ' 个会话）')
            refresh()
          })
          .catch(function (e) { setError(String(e.message)) })
          .finally(function () { setBusy(false) })
      }

      function doRestore() {
        if (!selected) { setError('请先选择一个备份点'); return }
        var scopeLabel = scope === 'config' ? '及配置（不含 API key）' : (scope === 'plugins' ? '及插件本体' : '')
        if (!window.confirm('确定从该备份还原吗？\n\n将恢复会话与记忆' + scopeLabel + '。\n还原前会自动备份当前状态到「还原前快照」。\n\nAPI key 永远不会被覆盖。')) return
        setRestoreBusy(true); setMessage(null); setError(null)
        api('/dsh-backup/restore', { method: 'POST', body: { backup: selected, scope: scope } })
          .then(function (r) {
            var msg = '还原完成：' + r.restored.sessions + ' 个会话'
            if (r.restored.config && r.restored.config.length) msg += '，配置：' + r.restored.config.join(', ')
            if (r.restored.plugins && r.restored.plugins.length) msg += '，插件：' + r.restored.plugins.join(', ')
            msg += '。还原前快照：' + r.safetySnapshot
            setMessage(msg)
            refresh()
          })
          .catch(function (e) { setError(String(e.message)) })
          .finally(function () { setRestoreBusy(false) })
      }

      function saveConfig() {
        if (!cfgDraft) return
        setBusy(true); setMessage(null); setError(null)
        api('/dsh-backup/config', { method: 'POST', body: cfgDraft })
          .then(function (r) {
            setMessage('设置已保存' + (r.saved ? '' : '（保存失败）') + '：' + (r.note || ''))
            refresh()
          })
          .catch(function (e) { setError(String(e.message)) })
          .finally(function () { setBusy(false) })
      }

      function cfgField(k, v) {
        if (!cfgDraft) return
        var next = Object.assign({}, cfgDraft)
        next[k] = v
        setCfgDraft(next)
      }

      function intervalLabel(hours) {
        var h = Number(hours)
        if (!h) return '—'
        if (h % (24 * 7) === 0) return '每' + (h / (24 * 7)) + '周'
        if (h % 24 === 0) return '每' + (h / 24) + '天'
        return '每' + h + '小时'
      }

      var all = []
      if (history) {
        all = (history.fulls || []).map(function (d) { return { type: '全量', dir: d.dir, path: d.path } })
          .concat((history.increments || []).map(function (d) { return { type: '增量', dir: d.dir, path: d.path } }))
      }

      // ---- layout ---------------------------------------------------------
      // Panel header: 独立的区块标识，避免与 dsh 自身状态混淆
      var panelHead = React.createElement('div', { className: 'dshbk_head' },
        React.createElement('span', { className: 'dshbk_icon' },
          React.createElement('svg', { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
            React.createElement('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }))),
        React.createElement('span', { className: 'dshbk_headTitle' }, '备份'),
        React.createElement('span', { className: 'dshbk_headDesc' }, 'dsh 数据备份与还原'))

      // Group 1: 备份状态（明确前缀，避免误读为 dsh 运行状态）
      var statusGroup = React.createElement('div', { className: 'dshbk_group' },
        React.createElement('div', { className: 'dshbk_subTitle' }, '备份状态',
          status && React.createElement('span', { style: { marginLeft: '8px' } },
            React.createElement('span', { className: status.running ? 'dshbk_badgeBusy' : 'dshbk_badge' },
              status.running ? '备份中…' : '正常'))),
        status ? React.createElement('div', { className: 'dshbk_subGroup' }, [
          row('上次全量', fmtTime(status.lastFull)),
          row('上次增量', fmtTime(status.lastIncremental)),
          row('下次检查', fmtTime(status.nextCheck)),
          row('备份位置', status.backupRoot),
          row('保留策略', '全量 ' + status.fullCount + '/2 · 增量 ' + status.incrementalCount + '/30'),
        ]) : React.createElement('div', { className: 'dshbk_groupHint' }, '加载中…'))

      // Group 2: 立即备份
      var backupGroup = React.createElement('div', { className: 'dshbk_group' },
        React.createElement('div', { className: 'dshbk_subTitle' }, '立即备份'),
        React.createElement('div', { className: 'dshbk_btnRow' },
          React.createElement('button', { className: 'dshbk_btn', disabled: busy, onClick: function () { runBackup('incremental') } }, busy ? '…' : '增量备份'),
          React.createElement('button', { className: 'dshbk_btn dshbk_btnPrimary', disabled: busy, onClick: function () { runBackup('full') } }, busy ? '…' : '全量备份')),
        React.createElement('div', { className: 'dshbk_groupHint' }, '增量：' + (cfgDraft ? intervalLabel(cfgDraft.incrementIntervalHours) : '每日') + '一次，保留 ' + (cfgDraft ? cfgDraft.incrementRetention : 30) + ' 天；全量：' + (cfgDraft ? intervalLabel(cfgDraft.fullIntervalHours) : '每月') + '一次，保留 ' + (cfgDraft ? cfgDraft.fullRetention : 2) + ' 份。'))

      // Group 3: 还原
      var restoreGroup = React.createElement('div', { className: 'dshbk_group' },
        React.createElement('div', { className: 'dshbk_subTitle' }, '还原'),
        React.createElement('div', { className: 'dshbk_btnRow' },
          React.createElement('select', { className: 'dshbk_select', value: selected, onChange: function (e) { setSelected(e.target.value) } },
            React.createElement('option', { value: '' }, '选择备份点…'),
            all.map(function (b) {
              return React.createElement('option', { key: b.path, value: b.path }, '[' + b.type + '] ' + b.dir)
            })),
          React.createElement('div', { className: 'dshbk_segmented' },
            React.createElement('button', { className: scope === 'memory' ? 'dshbk_segActive' : 'dshbk_seg', onClick: function () { setScope('memory') } }, '会话+记忆'),
            React.createElement('button', { className: scope === 'config' ? 'dshbk_segActive' : 'dshbk_seg', onClick: function () { setScope('config') } }, '+配置'),
            React.createElement('button', { className: scope === 'plugins' ? 'dshbk_segActive' : 'dshbk_seg', onClick: function () { setScope('plugins') } }, '+插件'))),
        React.createElement('div', { className: 'dshbk_btnRow', style: { marginTop: '8px' } },
          React.createElement('button', { className: 'dshbk_btn dshbk_btnDanger', disabled: restoreBusy || !selected, onClick: doRestore }, restoreBusy ? '还原中…' : '执行还原')),
        React.createElement('div', { className: 'dshbk_groupHint' }, '还原前自动快照当前状态；API key（.credentials.yaml、modlens-config.json）永不覆盖。'))

      // Group 4: 设置（备份位置 / 间隔 / 保留）
      var settingsGroup = React.createElement('div', { className: 'dshbk_group' },
        React.createElement('div', { className: 'dshbk_subTitle' }, '设置'),
        React.createElement('div', { className: 'dshbk_subGroup' },
          React.createElement('div', { className: 'dshbk_row' },
            React.createElement('span', { className: 'dshbk_rowLabel' }, '备份位置'),
            React.createElement('input', { className: 'dshbk_select', style: { flex: '1', height: '28px' }, value: cfgDraft ? cfgDraft.backupRoot : '', onChange: function (e) { cfgField('backupRoot', e.target.value) }, placeholder: 'D:\\Program Files\\harness\\备份' })),
          React.createElement('div', { className: 'dshbk_row' },
            React.createElement('span', { className: 'dshbk_rowLabel' }, '全量间隔'),
            React.createElement('input', { type: 'number', className: 'dshbk_select', style: { width: '72px' }, value: cfgDraft ? cfgDraft.fullIntervalHours : 720, min: '1', onChange: function (e) { cfgField('fullIntervalHours', Number(e.target.value)) } }),
            React.createElement('span', { className: 'dshbk_groupHint', style: { margin: '0' } }, '小时（' + (cfgDraft ? intervalLabel(cfgDraft.fullIntervalHours) : '每月') + '；168=每周，720=每月）')),
          React.createElement('div', { className: 'dshbk_row' },
            React.createElement('span', { className: 'dshbk_rowLabel' }, '增量间隔'),
            React.createElement('input', { type: 'number', className: 'dshbk_select', style: { width: '72px' }, value: cfgDraft ? cfgDraft.incrementIntervalHours : 24, min: '1', onChange: function (e) { cfgField('incrementIntervalHours', Number(e.target.value)) } }),
            React.createElement('span', { className: 'dshbk_groupHint', style: { margin: '0' } }, '小时（' + (cfgDraft ? intervalLabel(cfgDraft.incrementIntervalHours) : '每天') + '；1=每小时，24=每天）')),
          React.createElement('div', { className: 'dshbk_row' },
            React.createElement('span', { className: 'dshbk_rowLabel' }, '全量保留'),
            React.createElement('input', { type: 'number', className: 'dshbk_select', style: { width: '72px' }, value: cfgDraft ? cfgDraft.fullRetention : 2, min: '1', max: '10', onChange: function (e) { cfgField('fullRetention', Number(e.target.value)) } }),
            React.createElement('span', { className: 'dshbk_groupHint', style: { margin: '0' } }, '份')),
          React.createElement('div', { className: 'dshbk_row' },
            React.createElement('span', { className: 'dshbk_rowLabel' }, '增量保留'),
            React.createElement('input', { type: 'number', className: 'dshbk_select', style: { width: '72px' }, value: cfgDraft ? cfgDraft.incrementRetention : 30, min: '1', max: '365', onChange: function (e) { cfgField('incrementRetention', Number(e.target.value)) } }),
            React.createElement('span', { className: 'dshbk_groupHint', style: { margin: '0' } }, '天')),
          React.createElement('div', { className: 'dshbk_btnRow', style: { marginTop: '4px' } },
            React.createElement('button', { className: 'dshbk_btn dshbk_btnPrimary', disabled: busy || !cfgDraft, onClick: saveConfig }, '保存设置')),
          React.createElement('div', { className: 'dshbk_groupHint' }, '备份位置 / 间隔 / 保留在重启 dsh 后生效；策略为「距上次全量 ≥ 全量间隔 → 全量，否则距上次备份 ≥ 增量间隔 → 增量」。')))

      // 消息 / 策略说明
      var extras = []
      if (message) extras.push(React.createElement('div', { className: 'dshbk_msg dshbk_ok' }, message))
      if (error) extras.push(React.createElement('div', { className: 'dshbk_msg dshbk_err' }, error))
      extras.push(React.createElement('div', { className: 'dshbk_groupHint' },
        '备份策略：' + (cfgDraft ? intervalLabel(cfgDraft.fullIntervalHours) : '每月') + '全量（保留' + (cfgDraft ? cfgDraft.fullRetention : 2) + '份）、' + (cfgDraft ? intervalLabel(cfgDraft.incrementIntervalHours) : '每日') + '增量（保留' + (cfgDraft ? cfgDraft.incrementRetention : 30) + '天）；启动 / 定时检查 / 会话结束时自动备份。'))

      // 整体：可折叠卡片外壳（与 DSH重启等插件配置卡片一致）
      var content = React.createElement('div', { className: 'dshbk_panel' },
        panelHead,
        statusGroup, backupGroup, restoreGroup, settingsGroup,
        extras)
      return React.createElement('li', { className: 'dshbk_wrap' + (open ? ' dshbk_wrapOpen' : '') },
        React.createElement('button', { type: 'button', className: 'dshbk_wrapHead', 'aria-expanded': open, onClick: function () { setOpen(!open) } },
          React.createElement('span', { className: 'dshbk_wrapHeadText' },
            React.createElement('span', { className: 'dshbk_wrapName' }, '备份'),
            React.createElement('span', { className: 'dshbk_wrapDesc' }, 'dsh 数据备份与还原')),
          React.createElement('svg', { className: 'dshbk_wrapChevron' + (open ? ' dshbk_wrapChevronOpen' : ''), width: '14', height: '14', viewBox: '0 0 14 14', 'aria-hidden': 'true' },
            React.createElement('path', { d: 'M3.5 5.5 7 9l3.5-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        open ? React.createElement('div', { className: 'dshbk_wrapBody' }, content) : null)
    }

    // ---- slot registration ------------------------------------------------
    function registerCard(ctx) {
      // `slots` arrives via the top-level exports.inject declaration (the
      // client-side inject contract), so ctx.slots is available directly —
      // the same pattern as dsh-client-ui-aqua.
      try { react = require('react') } catch (e) { console.error('[dsh-backup] react unavailable:', e?.message ?? e); return }
      // 插件配置卡片（设置 → 插件 → 插件配置，与 DSH重启同列表）
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'dsh-backup', order: 20 }, function (cardProps) {
        return BackupCard(cardProps)
      }))
    }

    // Standard cordis client-plugin contract: the loader calls apply(ctx).
    // `slots` is a required dependency — declared here so ctx.slots is bound.
    exports.apply = function (ctx) {
      registerCard(ctx)
    }
    exports.inject = ['slots']
    return module.exports
  },
})
