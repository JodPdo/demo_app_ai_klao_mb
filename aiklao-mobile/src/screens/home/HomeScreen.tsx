import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { colors, radius, spacing, typography } from '@/theme';

export function HomeScreen() {
  const { user } = useAuth();

  return (
    <Screen padded background="alt">
      <Text style={styles.greeting}>สวัสดี {user?.displayName ?? ''}</Text>
      <Text style={styles.subtitle}>วันนี้พร้อมออกทริปหรือยัง?</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>ยังไม่มีทริปที่กำลังทำงาน</Text>
        <Text style={styles.cardBody}>
          กด "เริ่มทริปใหม่" เพื่อเริ่ม track ตำแหน่งของคุณ
        </Text>
        <Button
          label="เริ่มทริปใหม่"
          onPress={() => {
            /* Phase 5.2 — implement create trip flow */
          }}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
      </View>

      <Text style={styles.placeholder}>
        🚧 หน้านี้จะมี map + live tracking ใน Phase 5.2
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  cardBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  placeholder: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
