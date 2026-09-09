import type { CSSProperties } from 'react'

/** Dark palette shared by the devtools widgets (mirrors theme.css vars, with hex fallbacks). */
export const palette = {
  bg: 'var(--bg)',
  bgElev: 'var(--bg-elev)',
  editorBg: '#1b1d20',
  border: 'var(--border)',
  text: 'var(--text)',
  textDim: 'var(--text-dim)',
  accent: 'var(--accent)'
} as const

export const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 240,
  boxSizing: 'border-box',
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  overflow: 'hidden',
  background: palette.bgElev
}

export const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: '0 0 auto',
  padding: '6px 8px',
  borderBottom: `1px solid ${palette.border}`,
  background: palette.bgElev,
  fontSize: 12
}

/** Base button look so widgets read as "Lens" even before theme.css expands `.btn`. */
export const buttonStyle: CSSProperties = {
  appearance: 'none',
  border: `1px solid ${palette.border}`,
  background: 'rgba(255,255,255,0.03)',
  color: palette.text,
  borderRadius: 4,
  padding: '3px 9px',
  fontSize: 12,
  lineHeight: '16px',
  cursor: 'pointer'
}

/** Highlighted look for active toggles (Follow / Wrap). */
export function activeStyle(active: boolean): CSSProperties {
  return active
    ? { ...buttonStyle, background: palette.accent, borderColor: palette.accent, color: '#fff' }
    : buttonStyle
}

export const labelStyle: CSSProperties = {
  color: palette.textDim,
  fontSize: 12
}

/** Dark dropdown look (container / command selectors). */
export const selectStyle: CSSProperties = {
  ...buttonStyle,
  background: palette.editorBg,
  paddingRight: 4
}

/** Inline checkbox + caption (Previous / Timestamps toggles). */
export const checkLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: palette.text,
  fontSize: 12,
  cursor: 'pointer',
  userSelect: 'none'
}
