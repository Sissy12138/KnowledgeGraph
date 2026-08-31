import type { GraphNodeType } from '../features/graph/graph.types'

export type AppThemeId = 'softResearch' | 'coolMinimal' | 'warmPaper'

export type NodeVisualStyle = {
  background: string
  text: string
  fontFamily: string
  fontSize: number
}

export type AppTheme = {
  interface: {
    primary: string
    primaryDeep: string
    primarySoft: string
    primaryBorder: string
    background: string
    surface: string
    surfaceSubtle: string
    surfaceMuted: string
    sidebar: string
    sidebarText: string
    sidebarMuted: string
    text: string
    textSoft: string
    muted: string
    border: string
    focus: string
    onPrimary: string
    fontFamily: string
    baseFontSize: number
  }
  semantic: Record<'success' | 'warning' | 'danger' | 'info', {
    foreground: string
    background: string
    border: string
  }>
  graph: {
    nodes: Record<GraphNodeType, NodeVisualStyle>
    edge: string
    selectedBorder: string
  }
  shape: {
    cardRadius: string
    controlRadius: string
    cardShadow: string
  }
}

const FONT = 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif'

const SEMANTIC: AppTheme['semantic'] = {
  success: { foreground: '#166534', background: '#F0FDF4', border: '#BBF7D0' },
  warning: { foreground: '#92400E', background: '#FFFBEB', border: '#FDE68A' },
  danger: { foreground: '#991B1B', background: '#FEF2F2', border: '#FECACA' },
  info: { foreground: '#1E40AF', background: '#EFF6FF', border: '#BFDBFE' },
}

const node = (background: string, text = '#111827'): NodeVisualStyle => ({
  background,
  text,
  fontFamily: FONT,
  fontSize: 12,
})

const makeTheme = (
  interfaceTheme: AppTheme['interface'],
  nodeColors: Record<GraphNodeType, string>,
  nodeText: string,
  edge: string,
  shadow: string,
): AppTheme => ({
  interface: interfaceTheme,
  semantic: SEMANTIC,
  graph: {
    nodes: {
      paper: node(nodeColors.paper, nodeText),
      author: node(nodeColors.author, nodeText),
      concept: node(nodeColors.concept, nodeText),
      method: node(nodeColors.method, nodeText),
      finding: node(nodeColors.finding, nodeText),
    },
    edge,
    selectedBorder: interfaceTheme.onPrimary,
  },
  shape: { cardRadius: '12px', controlRadius: '8px', cardShadow: shadow },
})

export const DEFAULT_THEME_ID: AppThemeId = 'softResearch'

export const APP_THEMES = {
  softResearch: makeTheme(
    {
      primary: '#5B68D6',
      primaryDeep: '#4855B8',
      primarySoft: '#EEF0FF',
      primaryBorder: '#C7CDF8',
      background: '#F6F8FC',
      surface: '#FFFFFF',
      surfaceSubtle: '#F8FAFC',
      surfaceMuted: '#F1F4F9',
      sidebar: '#252A3D',
      sidebarText: '#CBD2E3',
      sidebarMuted: '#929AB2',
      text: '#172033',
      textSoft: '#475467',
      muted: '#667085',
      border: '#E3E8F2',
      focus: '#818CF8',
      onPrimary: '#FFFFFF',
      fontFamily: FONT,
      baseFontSize: 16,
    },
    { paper: '#BDD7FF', author: '#DCCBFF', concept: '#AEEBE7', method: '#FFE0A8', finding: '#C5E8C9' },
    '#111827',
    '#94A3B8',
    '0 18px 48px rgba(23, 32, 51, 0.10)',
  ),
  coolMinimal: makeTheme(
    {
      primary: '#5277A8',
      primaryDeep: '#3F5F87',
      primarySoft: '#EAF1F8',
      primaryBorder: '#C4D5E6',
      background: '#F4F7FA',
      surface: '#FBFDFF',
      surfaceSubtle: '#F7FAFC',
      surfaceMuted: '#EDF2F6',
      sidebar: '#24313F',
      sidebarText: '#CCD8E5',
      sidebarMuted: '#8EA0B2',
      text: '#172133',
      textSoft: '#405066',
      muted: '#66768A',
      border: '#DCE4EC',
      focus: '#6F91BA',
      onPrimary: '#FFFFFF',
      fontFamily: FONT,
      baseFontSize: 16,
    },
    { paper: '#C6DCF2', author: '#D8D2EC', concept: '#BFE3E0', method: '#E8D8B8', finding: '#CFE2D1' },
    '#111827',
    '#91A2B3',
    '0 18px 48px rgba(23, 33, 51, 0.09)',
  ),
  warmPaper: makeTheme(
    {
      primary: '#8C5B43',
      primaryDeep: '#724733',
      primarySoft: '#F4EAE3',
      primaryBorder: '#DDBFAC',
      background: '#F7F3EA',
      surface: '#FFFCF6',
      surfaceSubtle: '#FAF7F1',
      surfaceMuted: '#F0E9DE',
      sidebar: '#332F2A',
      sidebarText: '#DED5C9',
      sidebarMuted: '#A79D90',
      text: '#2B2925',
      textSoft: '#5F584F',
      muted: '#746E64',
      border: '#E7DED0',
      focus: '#B98262',
      onPrimary: '#FFFFFF',
      fontFamily: FONT,
      baseFontSize: 16,
    },
    { paper: '#C9D9E8', author: '#DCCFE2', concept: '#C6DDD3', method: '#F1D5A5', finding: '#D1DFC3' },
    '#171512',
    '#A59C90',
    '0 18px 48px rgba(43, 41, 37, 0.10)',
  ),
} satisfies Record<AppThemeId, AppTheme>

let activeThemeId: AppThemeId = DEFAULT_THEME_ID

export function getAppTheme(themeId: AppThemeId = activeThemeId): AppTheme {
  return APP_THEMES[themeId]
}

export function applyAppTheme(themeId: AppThemeId): void {
  activeThemeId = themeId
  const theme = APP_THEMES[themeId]
  const values: Record<string, string> = {
    '--color-primary': theme.interface.primary,
    '--color-primary-deep': theme.interface.primaryDeep,
    '--color-primary-soft': theme.interface.primarySoft,
    '--color-primary-border': theme.interface.primaryBorder,
    '--color-background': theme.interface.background,
    '--color-surface': theme.interface.surface,
    '--color-surface-subtle': theme.interface.surfaceSubtle,
    '--color-surface-muted': theme.interface.surfaceMuted,
    '--color-sidebar': theme.interface.sidebar,
    '--color-sidebar-text': theme.interface.sidebarText,
    '--color-sidebar-muted': theme.interface.sidebarMuted,
    '--color-text': theme.interface.text,
    '--color-text-soft': theme.interface.textSoft,
    '--color-muted': theme.interface.muted,
    '--color-border': theme.interface.border,
    '--color-focus': theme.interface.focus,
    '--color-on-primary': theme.interface.onPrimary,
    '--font-interface': theme.interface.fontFamily,
    '--font-size-base': `${theme.interface.baseFontSize}px`,
    '--radius-card': theme.shape.cardRadius,
    '--radius-control': theme.shape.controlRadius,
    '--shadow-card': theme.shape.cardShadow,
    '--graph-node-paper': theme.graph.nodes.paper.background,
    '--graph-node-author': theme.graph.nodes.author.background,
    '--graph-node-concept': theme.graph.nodes.concept.background,
    '--graph-node-method': theme.graph.nodes.method.background,
    '--graph-node-finding': theme.graph.nodes.finding.background,
    '--graph-edge': theme.graph.edge,
    '--graph-selected-border': theme.graph.selectedBorder,
  }
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value)
  }
  for (const status of ['success', 'warning', 'danger', 'info'] as const) {
    document.documentElement.style.setProperty(`--color-${status}-foreground`, theme.semantic[status].foreground)
    document.documentElement.style.setProperty(`--color-${status}-background`, theme.semantic[status].background)
    document.documentElement.style.setProperty(`--color-${status}-border`, theme.semantic[status].border)
  }
}

export function applyFontScale(percent: number): void {
  const baseFontSize = getAppTheme().interface.baseFontSize
  document.documentElement.style.setProperty('--font-size-root', `${baseFontSize * percent / 100}px`)
}
