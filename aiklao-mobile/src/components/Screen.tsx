import React, { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  background?: 'default' | 'alt';
}

/**
 * Standard screen wrapper — handles safe area, status bar, and base padding
 */
export function Screen({
  children,
  style,
  padded = true,
  background = 'default',
}: ScreenProps) {
  const bgColor =
    background === 'alt' ? colors.backgroundAlt : colors.background;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={[padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  padded: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
