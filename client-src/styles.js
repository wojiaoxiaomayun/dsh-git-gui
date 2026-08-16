/**
 * Panel stylesheet, injected as a plugin-owned <style> tag at
 * materialization. Colors ride the shared theme tokens so light/dark both
 * work; every class is `gg-` prefixed to avoid collisions.
 */
const css = `
/* text on accent fills: brand/state tokens flip to LIGHT shades in dark
   mode (brand-primary = near-white), so fixed white text became invisible;
   this variable flips together with the shell's dark-theme attribute and is
   defined at body level because the sidebar badge lives outside the panel. */
body { --gg-on-accent: #ffffff; }
body[data-ds-dark-theme] { --gg-on-accent: #10141b; }
.gg-panel {
  position: absolute; top: 12px; right: 12px; bottom: 12px;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
  overflow: hidden;
  pointer-events: auto;
  z-index: 1;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
}
.gg-resize {
  position: absolute; left: -3px; top: 0; bottom: 0; width: 7px;
  cursor: col-resize; z-index: 3;
}
.gg-resize:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px 6px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.gg-panel-title { font-weight: 600; flex: 1; }
.gg-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; padding: 0; flex: none;
}
.gg-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.gg-icon-btn:disabled { opacity: .4; cursor: default; }
.gg-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 12px; padding: 4px 10px; cursor: pointer; white-space: nowrap;
}
.gg-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-btn:disabled { opacity: .45; cursor: default; }
.gg-btn-primary {
  background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--gg-on-accent);
}
.gg-btn-primary:hover { filter: brightness(1.08); background: var(--dsw-alias-brand-primary); color: var(--gg-on-accent); }
.gg-btn-danger { background: var(--dsw-alias-state-error-primary); border-color: transparent; color: var(--gg-on-accent); }
.gg-mini-btn {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; padding: 1px 7px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.gg-mini-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.gg-mini-btn:disabled { opacity: .4; cursor: default; }
.gg-mini-danger:hover { color: var(--dsw-alias-state-error-primary); }
.gg-row-btn { width: 22px; height: 22px; opacity: 0; }
.gg-file:hover .gg-row-btn, .gg-log-row:hover .gg-row-btn { opacity: 1; }

.gg-banner {
  display: flex; align-items: center; gap: 6px;
  margin: 6px 10px 0; padding: 5px 9px;
  border-radius: 7px; font-size: 11.5px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  color: var(--dsw-alias-label-primary);
}
.gg-banner .gg-icon { flex: none; color: var(--dsw-alias-state-warn-primary); }

.gg-wsbar {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 10px 7px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.gg-ws-name { display: inline-flex; align-items: center; gap: 5px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-ws-branch { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-brand-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-ws-detached { color: var(--dsw-alias-state-warn-primary); }
.gg-ws-ab { font-size: 11px; }
.gg-ws-busy { color: var(--dsw-alias-brand-primary); font-size: 11px; }
.gg-spacer { flex: 1; }

.gg-tabs { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.gg-tabbar {
  display: flex; gap: 2px; padding: 5px 10px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  overflow-x: auto; flex: none;
}
.gg-tab {
  border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 12px;
  padding: 6px 9px; border-bottom: 2px solid transparent; white-space: nowrap;
}
.gg-tab:hover { color: var(--dsw-alias-label-primary); }
.gg-tab-active { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.gg-tabbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.gg-panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.gg-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 26px 14px; text-align: center;
  color: var(--dsw-alias-label-secondary); flex: 1;
}
.gg-empty-err { color: var(--dsw-alias-state-error-primary); }
.gg-empty-title { font-weight: 600; color: var(--dsw-alias-label-primary); }

.gg-status { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.gg-commit { padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }
.gg-commit-input {
  width: 100%; box-sizing: border-box; resize: vertical;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  color: var(--dsw-alias-label-primary); font: inherit; padding: 6px 8px;
}
.gg-commit-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); }
.gg-commit-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.gg-identity { font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-identity-missing { color: var(--dsw-alias-state-warn-primary); }
.gg-status-main { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.gg-files { flex: 1 1 45%; min-height: 90px; overflow-y: auto; }

.gg-group { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.gg-group-head {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 12px 4px; font-weight: 600; font-size: 11px;
  color: var(--dsw-alias-label-secondary); position: sticky; top: 0;
  background: var(--dsw-alias-bg-layer-1); z-index: 1;
}
.gg-group-name { font-weight: 600; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gg-group-count { font-weight: 400; }
.gg-group-body { display: flex; flex-direction: column; }

.gg-file {
  display: flex; align-items: center; gap: 7px;
  padding: 3px 10px; cursor: pointer;
}
.gg-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-file-conflict .gg-file-name { color: var(--dsw-alias-state-error-primary); }
.gg-letter {
  flex: none; width: 17px; height: 17px; border: none; border-radius: 4px;
  font-size: 11px; font-weight: 700; color: var(--gg-on-accent); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.gg-l-m { background: var(--dsw-alias-brand-primary); }
.gg-l-a { background: var(--dsw-alias-state-success-primary); }
.gg-l-d { background: var(--dsw-alias-state-error-primary); }
.gg-l-r { background: var(--dsw-alias-state-warn-primary); }
.gg-l-c { background: var(--dsw-alias-state-warn-primary); }
.gg-l-u { background: var(--dsw-alias-state-error-primary); }
.gg-l-q { background: var(--dsw-alias-label-secondary); }
.gg-l-t { background: var(--dsw-alias-label-secondary); }
.gg-file-main { display: flex; min-width: 0; flex: 1; }
.gg-file-dir { color: var(--dsw-alias-label-secondary); }
.gg-file-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-file-renamed { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-left: 6px; }

.gg-diff { flex: 1 1 55%; min-height: 120px; display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l2); }
.gg-diff-head {
  display: flex; align-items: center; gap: 7px; padding: 5px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none;
  font-weight: 600; font-size: 11.5px;
}
.gg-diff-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.gg-diff-rename { color: var(--dsw-alias-label-secondary); font-weight: 400; font-size: 11px; }
.gg-chip {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px;
  font-size: 10.5px; padding: 0 7px; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; flex: none;
}
.gg-diff-scroll { flex: 1; overflow: auto; }
.gg-hunks { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 11.5px; }
.gg-hunk-head { padding: 4px 10px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); position: sticky; top: 0; }
.gg-line { display: flex; align-items: baseline; white-space: pre; padding: 0 10px; min-width: max-content; }
.gg-line-no { flex: none; width: 34px; text-align: right; color: var(--dsw-alias-label-secondary); font-size: 10.5px; user-select: none; padding-right: 8px; }
.gg-line-mark { flex: none; width: 14px; text-align: center; user-select: none; }
.gg-line-text { flex: 1; }
.gg-line-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent); }
.gg-line-add .gg-line-mark { color: var(--dsw-alias-state-success-primary); }
.gg-line-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent); }
.gg-line-del .gg-line-mark { color: var(--dsw-alias-state-error-primary); }
.gg-line-nonl { color: var(--dsw-alias-state-warn-primary); margin-left: 6px; }

.gg-log { overflow-y: auto; flex: 1; }
.gg-log-row { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.gg-log-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-log-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.gg-log-subject { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-log-meta { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gg-log-hash { font-family: ui-monospace, Consolas, monospace; }

.gg-branches { overflow-y: auto; flex: 1; padding-bottom: 12px; }
.gg-branch-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; }
.gg-branch-new { display: flex; gap: 6px; padding: 0 10px 8px; }
.gg-input {
  flex: 1; min-width: 0; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  color: var(--dsw-alias-label-primary); font: inherit; padding: 5px 8px;
}
.gg-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); }
.gg-ref-group { padding: 6px 10px 4px; }
.gg-ref-row { display: flex; align-items: center; gap: 7px; padding: 3px 0; }
.gg-ref-current { font-weight: 600; }
.gg-ref-name {
  display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  border: none; background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer; padding: 2px 0; overflow: hidden;
}
.gg-ref-name:hover:not(:disabled) { color: var(--dsw-alias-brand-primary); }
.gg-ref-name:disabled { cursor: default; }
.gg-ref-upstream { color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 400; }
.gg-remote-row { display: flex; gap: 8px; padding: 2px 0; }
.gg-remote-url { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.gg-stash { overflow-y: auto; flex: 1; }
.gg-stash-new { display: flex; gap: 6px; padding: 8px 10px; }
.gg-stash-list { padding: 0 10px 8px; }
.gg-stash-row { display: flex; align-items: center; gap: 7px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.gg-stash-ref { font-family: ui-monospace, Consolas, monospace; font-size: 11px; flex: none; }
.gg-stash-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.gg-timeline { overflow-y: auto; flex: 1; padding: 6px 10px; }
.gg-tl-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: none; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: inherit; font: inherit; text-align: left;
  padding: 6px 2px; cursor: pointer;
}
.gg-tl-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-tl-tool {
  flex: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px;
  font-size: 10px; padding: 0 5px; color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, Consolas, monospace;
}
.gg-tl-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.gg-tl-meta { flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }

/* workspace file tree */
.gg-files-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.gg-files-toolbar {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none;
}
.gg-files-legend { display: flex; gap: 10px; flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.gg-legend-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.gg-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; flex: none; }
.gg-swatch-mod { background: var(--dsw-alias-state-business-primary, #3964fe); }
.gg-swatch-unt { background: var(--dsw-alias-state-error-primary, #dc2626); }
.gg-swatch-clean { background: var(--dsw-alias-label-primary); }
.gg-files-tree { flex: 1; overflow: auto; padding-bottom: 8px; }
.gg-files-note { padding: 4px 10px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gg-tree-row {
  display: flex; align-items: center; gap: 5px;
  padding: 2.5px 10px; cursor: pointer; min-width: 0;
}
.gg-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-tree-dir { color: var(--dsw-alias-label-secondary); }
.gg-tree-file { color: var(--dsw-alias-label-primary); }
.gg-tree-file.gg-tree-modified { color: var(--dsw-alias-state-business-primary, #3964fe); }
.gg-tree-file.gg-tree-untracked { color: var(--dsw-alias-state-error-primary, #dc2626); }
.gg-tree-toggle {
  flex: none; width: 16px; height: 16px; border: none; background: transparent;
  color: inherit; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.gg-tree-chevron { display: inline-flex; transition: transform .12s ease; }
.gg-tree-chevron-closed { transform: rotate(-90deg); }
.gg-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.gg-output { border-top: 1px solid var(--dsw-alias-border-l1); flex: none; }
.gg-output-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  border: none; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; padding: 5px 12px; cursor: pointer;
}
.gg-output-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.gg-output-title { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gg-output-body {
  margin: 0 12px 10px; padding: 8px; max-height: 130px; overflow: auto;
  background: var(--dsw-alias-bg-layer-2); border-radius: 7px;
  font-family: ui-monospace, Consolas, monospace; font-size: 11px;
  white-space: pre-wrap; word-break: break-all;
}

.gg-modal-backdrop {
  position: absolute; inset: 0; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; z-index: 6;
}
.gg-modal {
  width: min(380px, calc(100% - 40px)); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 16px 50px rgba(0,0,0,.35);
}
.gg-modal-danger { border-color: var(--dsw-alias-state-error-primary); }
.gg-modal-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; }
.gg-modal-danger .gg-modal-title { color: var(--dsw-alias-state-error-primary); }
.gg-modal-body { font-size: 12.5px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.gg-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.gg-field { display: flex; flex-direction: column; gap: 4px; }
.gg-field-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gg-icon-warn { color: var(--dsw-alias-state-warn-primary); }

.gg-toast {
  position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 7;
  padding: 8px 12px; border-radius: 8px; font-size: 12px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 8px 24px rgba(0,0,0,.3);
  word-break: break-all;
}
.gg-toast-err { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.gg-toast-warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }

/* sidebar footer entry */
.gg-footer-btn {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
  border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px;
  padding: 0 6px; height: 36px; border-radius: 8px; position: relative;
}
.gg-footer-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.gg-footer-btn.gg-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.gg-footer-icon { display: inline-flex; align-items: center; justify-content: center; }
.gg-footer-marks { display: inline-flex; gap: 3px; align-items: center; }
.gg-badge {
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  background: var(--dsw-alias-brand-primary); color: var(--gg-on-accent);
  font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box;
}
.gg-badge-err { background: var(--dsw-alias-state-error-primary); }

.gg-icon { flex: none; }
`

module.exports = { css }
