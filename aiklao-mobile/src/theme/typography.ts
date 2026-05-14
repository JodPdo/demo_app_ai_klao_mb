import { TextStyle } from 'react-native';

/**
 * Type scale — 8pt grid
 */
export const typography = {
  // Headings
  h1: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
  } as TextStyle,
  h2: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  } as TextStyle,
  h3: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
  } as TextStyle,

  // Body
  bodyLarge: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
  } as TextStyle,
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  } as TextStyle,
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  } as TextStyle,

  // Captions / labels
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  } as TextStyle,
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  } as TextStyle,
} as const;

export type TypographyKey = keyof typeof typography;
