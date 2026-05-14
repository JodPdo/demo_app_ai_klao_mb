import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { colors, radius, spacing, typography } from '@/theme';
import Constants from 'expo-constants';

export function SettingsScreen() {
  const { user, signOut } = useAuth();

  const handleLogout = () => {
    Alert.alert('ออกจากระบบ?', 'คุณจะต้อง login ใหม่ครั้งถัดไป', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ออก', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <Screen padded background="alt">
      <Text style={styles.title}>ตั้งค่า</Text>

      <View style={styles.card}>
        <Text style={styles.label}>บัญชี</Text>
        <Text style={styles.value}>{user?.displayName ?? '—'}</Text>
        <Text style={styles.hint}>LINE ID: {user?.lineUserId ?? '—'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>เกี่ยวกับ</Text>
        <Text style={styles.value}>AiKlao v{Constants.expoConfig?.version}</Text>
        <Text style={styles.hint}>
          API: {Constants.expoConfig?.extra?.apiBaseUrl as string}
        </Text>
      </View>

      <Button
        label="ออกจากระบบ"
        variant="danger"
        onPress={handleLogout}
        fullWidth
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.bodyLarge,
    color: colors.textPrimary,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
