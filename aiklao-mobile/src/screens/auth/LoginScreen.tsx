import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { colors, spacing, typography } from '@/theme';

export function LoginScreen() {
  const { signInWithLine } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await signInWithLine();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ';
      Alert.alert('ผิดพลาด', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen padded background="alt">
      <View style={styles.hero}>
        <Text style={styles.title}>AiKlao</Text>
        <Text style={styles.subtitle}>
          ติดตามทริปของคุณแบบ realtime
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="เข้าสู่ระบบด้วย LINE"
          onPress={handleLogin}
          loading={loading}
          fullWidth
        />
        <Text style={styles.note}>
          ใช้บัญชี LINE เดียวกับที่คุณใช้ใน LIFF — trip ของคุณจะ sync อัตโนมัติ
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    paddingBottom: spacing.xl,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
