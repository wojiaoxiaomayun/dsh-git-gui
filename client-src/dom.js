/**
 * Tiny DOM/React helpers for the client bundle (no JSX: hyperscript only).
 */
const React = require('react')

/** Hyperscript: h('div', {className}, children...) -> React.createElement. */
function h(tag, props, ...children) {
  if (props === null || props === undefined) props = {}
  const flat = []
  const push = (child) => {
    if (child === null || child === undefined || child === false) return
    if (Array.isArray(child)) {
      for (const c of child) push(c)
    } else {
      flat.push(child)
    }
  }
  for (const child of children) push(child)
  return React.createElement(tag, props, ...flat)
}

/** Join class names, skipping falsy. */
function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

/** Inline SVG icon (stroke = currentColor). */
function icon(pathData, size) {
  return h('svg', {
    className: 'gg-icon',
    width: size ?? 14,
    height: size ?? 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, h('path', { d: pathData }))
}

/** Inline SVG icon (fill = currentColor, iconfont-style 1024 viewBox). */
function fillIcon(pathData, size) {
  return h('svg', {
    className: 'gg-icon',
    width: size ?? 14,
    height: size ?? 14,
    viewBox: '0 0 1024 1024',
    fill: 'currentColor',
    'aria-hidden': 'true',
  }, h('path', { d: pathData }))
}

const ICONS = {
  git: fillIcon('M110.933333 451.84 357.546667 204.8 429.653333 277.333333C419.413333 313.6 436.053333 353.28 469.333333 372.48L469.333333 608.853333C443.733333 623.36 426.666667 651.093333 426.666667 682.666667 426.666667 729.6 465.066667 768 512 768 558.933333 768 597.333333 729.6 597.333333 682.666667 597.333333 651.093333 580.266667 623.36 554.666667 608.853333L554.666667 401.493333 642.986667 490.666667C640 497.066667 640 504.32 640 512 640 558.933333 678.4 597.333333 725.333333 597.333333 772.266667 597.333333 810.666667 558.933333 810.666667 512 810.666667 465.066667 772.266667 426.666667 725.333333 426.666667 717.653333 426.666667 710.4 426.666667 704 429.653333L594.346667 320C605.44 280.32 584.96 236.8 545.28 220.16 526.933333 213.333333 507.733333 211.626667 490.666667 216.32L418.133333 144.213333 451.84 110.933333C485.12 77.226667 538.88 77.226667 572.16 110.933333L913.066667 451.84C946.773333 485.12 946.773333 538.88 913.066667 572.16L572.16 913.066667C538.88 946.773333 485.12 946.773333 451.84 913.066667L110.933333 572.16C77.226667 538.88 77.226667 485.12 110.933333 451.84Z', 16),
  refresh: icon('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3', 13),
  close: icon('M4 4l8 8M12 4l-8 8', 13),
  check: icon('M2.5 8.5 6 12l7.5-8', 13),
  plus: icon('M8 2.5v11M2.5 8h11', 13),
  trash: icon('M2.5 4h11M6.5 4V2.5h3V4M4 4l1 9.5h6L12 4', 13),
  undo: icon('M6 4.5 2.5 8 6 11.5M3 8h7.5a4 4 0 0 1 0 8H8', 13),
  branch: icon('M4 3v5.5M12 3v5.5M4 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm8 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 11.5c0-3 8-1 8-5', 14),
  clock: icon('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5', 13),
  folder: icon('M1.5 3.5h4l1.5 2h7.5v7h-13v-9Z', 13),
  alert: icon('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 5v3.5M8 11.2v.1', 13),
  down: icon('M3.5 6 8 10.5 12.5 6', 13),
  up: icon('M3.5 10 8 5.5l4.5 4.5', 13),
  chevron: icon('M5.5 3.5 10 8l-4.5 4.5', 12),
  file: icon('M3 2h6l4 4v8H3V2Zm6 0v4h4', 13),
  diff: icon('M2 12h5m3 0h4M2 8h5m3 0h4M2 4h5m3 0h4', 13),
  robot: icon('M8 1.5v3M8 14.5a3 3 0 0 0 3 3M8 14.5a3 3 0 0 1-3 3M2.5 8.5h.5a1 1 0 0 1 1 1V13a1.5 1.5 0 0 0 3 0V5a2.5 2.5 0 0 1 5 0v8a1.5 1.5 0 0 0 3 0V9.5a1 1 0 0 1 1-1h.5M8 4.5a3 3 0 0 1 0 6', 15),
  globe: icon('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c1.8 1.8 2.7 4 2.7 6.5s-.9 4.7-2.7 6.5C6.2 12.7 5.3 10.5 5.3 8S6.2 3.3 8 1.5Z', 14),
}

module.exports = { h, cx, icon, fillIcon, ICONS, React }
