import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { colors, spacing, typography } from '@/theme';

export function TripsScreen() {
  return (
    <Screen padded background="alt">
      <Text style={styles.title}>ทริปของฉัน</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>ยังไม่มีทริปย้อนหลัง</Text>
        <Text style={styles.emptyBody}>
          ทริปที่เคยทำจะแสดงที่นี่ — Phase 5.2 จะ wire กับ backend
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
