import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const containerStyle: ViewStyle = {
    ...styles.base,
    ...variantStyles[variant].container,
    ...(fullWidth && { alignSelf: 'stretch' }),
    ...(isDisabled && { opacity: 0.5 }),
    ...style,
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        containerStyle,
        pressed && !isDisabled && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].label.color} />
      ) : (
        <Text style={[styles.label, variantStyles[variant].label]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    flexDirection: 'row',
  },
  label: {
    ...typography.button,
  },
});

const variantStyles: Record<
  ButtonVariant,
  { container: ViewStyle; label: { color: string } }
> = {
  primary: {
    container: { backgroundColor: colors.primary },
    label: { color: colors.white },
  },
  secondary: {
    container: {
      backgroundColor: colors.white,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    label: { color: colors.primary },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    label: { color: colors.primary },
  },
  danger: {
    container: { backgroundColor: colors.danger },
    label: { color: colors.white },
  },
};
