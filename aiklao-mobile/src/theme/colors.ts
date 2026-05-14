/**
 * AiKlao color palette
 * Primary brand: forest green (#0E7C66) — สื่อถึงการเดินทาง + ธรรมชาติ
 */
export const colors = {
  // Brand
  primary: '#0E7C66',
  primaryDark: '#0A5C4C',
  primaryLight: '#3DA88F',

  // Semantic
  success: '#2E7D32',
  warning: '#E89B23',
  danger: '#D14343',
  info: '#1E88E5',

  // Neutrals
  black: '#0F1419',
  gray900: '#1A1F24',
  gray800: '#2D3439',
  gray700: '#4A5259',
  gray600: '#6B7480',
  gray500: '#8E97A1',
  gray400: '#B5BCC4',
  gray300: '#D6DBE0',
  gray200: '#E8ECEF',
  gray100: '#F4F6F8',
  white: '#FFFFFF',

  // Surfaces
  background: '#FFFFFF',
  backgroundAlt: '#F4F6F8',
  surface: '#FFFFFF',
  border: '#E8ECEF',

  // Text
  textPrimary: '#0F1419',
  textSecondary: '#6B7480',
  textInverse: '#FFFFFF',
} as const;

export type ColorKey = keyof typeof colors;
