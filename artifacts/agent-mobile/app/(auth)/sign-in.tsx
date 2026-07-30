import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSignIn, useAuth } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useBiometrics } from '@/hooks/useBiometrics';
import { bioSessionState } from '@/utils/bioSessionState';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn, userId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { candidateName, electionYear } = useCampaignConfig();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  // For an already-signed-in session userId is defined; for a fresh login
  // it starts null and is not used — enrollment is offered from home layout.
  const bio = useBiometrics(userId);
  const [bioError, setBioError] = useState('');
  /**
   * true  → active Clerk session + biometric enrolled → show biometric screen.
   * false → show the normal email/password form.
   */
  const [bioMode, setBioMode] = useState(false);

  const isLoading = fetchStatus === 'fetching';

  // ── Determine whether to boot into biometric mode ──────────────────────────
  useEffect(() => {
    if (!bio.loading) {
      setBioMode(isSignedIn === true && bio.enrolled);
    }
  }, [bio.loading, bio.enrolled, isSignedIn]);

  // ── Auto-prompt biometrics on first mount when enrolled ────────────────────
  useEffect(() => {
    if (bioMode) {
      const timer = setTimeout(() => { handleBiometricSignIn(); }, 400);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioMode]);

  // ── Biometric sign-in ──────────────────────────────────────────────────────
  const handleBiometricSignIn = useCallback(async () => {
    setBioError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ok = await bio.authenticate(`Sign in to ${candidateName} Agent`);
    if (ok) {
      bioSessionState.setBypassOnce();
      router.replace('/(home)');
    } else {
      setBioError('Biometric verification failed. Use your password below.');
      setBioMode(false);
    }
  }, [bio, router]);

  // ── Shared finalization helper (password + MFA paths) ──────────────────────
  /**
   * Called after a successful Clerk sign-in for both password and MFA paths.
   * Sets the bypass so the home layout skips its initial lock, then signals
   * whether to offer biometric enrollment (handled in the home layout where
   * userId from useAuth() is guaranteed to be the correct authenticated value).
   */
  const finalizeAndNavigate = useCallback(async () => {
    bioSessionState.setBypassOnce();
    if (bio.hardwareAvailable && !bio.enrolled) {
      bioSessionState.setOfferEnrollment();
    }
    router.replace('/(home)');
  }, [bio.hardwareAvailable, bio.enrolled, router]);

  // ── Password sign-in ───────────────────────────────────────────────────────
  const handleSubmit = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return;
    if (signIn.status === 'complete') {
      await signIn.finalize({ navigate: finalizeAndNavigate });
    }
  };

  // ── MFA ────────────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code: verifyCode });
    if (signIn.status === 'complete') {
      await signIn.finalize({ navigate: finalizeAndNavigate });
    }
  };

  const s = styles(colors);

  // ── MFA screen ─────────────────────────────────────────────────────────────
  if (signIn.status === 'needs_client_trust') {
    return (
      <View style={[s.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
        <Text style={s.title}>Verify Identity</Text>
        <Text style={s.subtitle}>Enter the code sent to your email</Text>
        <TextInput
          style={[s.input, { fontSize: 24, letterSpacing: 8, textAlign: 'center' }]}
          placeholder="000000"
          placeholderTextColor={colors.mutedForeground}
          value={verifyCode}
          onChangeText={setVerifyCode}
          keyboardType="number-pad"
        />
        {errors.fields.code ? (
          <Text style={s.error}>{errors.fields.code.message}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [s.button, pressed && s.buttonPressed, isLoading && s.buttonDisabled]}
          onPress={handleVerify}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.buttonText}>Verify</Text>
          )}
        </Pressable>
        <Pressable style={s.textLink} onPress={() => signIn.mfa.sendEmailCode()}>
          <Text style={s.textLinkLabel}>Resend code</Text>
        </Pressable>
      </View>
    );
  }

  // ── Biometric unlock screen (active session + enrolled) ────────────────────
  if (bioMode) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 24, alignItems: 'center' }]}>
        <Text style={[s.appTagline, { marginBottom: 60 }]}>Field Agent Portal</Text>

        <Pressable
          style={({ pressed }) => [s.bioBigBtn, pressed && { opacity: 0.75 }]}
          onPress={handleBiometricSignIn}
          accessibilityLabel={`Sign in with ${bio.biometricLabel}`}
          accessibilityRole="button"
        >
          <Ionicons name={bio.biometricIcon} size={52} color={colors.primaryForeground} />
        </Pressable>

        <Text style={s.bioHint}>Tap to sign in with {bio.biometricLabel}</Text>

        {bioError ? <Text style={[s.error, { textAlign: 'center', marginTop: 16 }]}>{bioError}</Text> : null}

        <Pressable style={[s.textLink, { marginTop: 32 }]} onPress={() => setBioMode(false)}>
          <Text style={s.textLinkLabel}>Use password instead</Text>
        </Pressable>
      </View>
    );
  }

  // ── Normal email + password form ───────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.brand}>
          <Text style={s.appTagline}>Field Agent Portal</Text>
        </View>

        <View style={s.formSection}>
          <Text style={s.title}>Sign in</Text>
          <Text style={s.subtitle}>Access your polling station tools</Text>

          {bio.enrolled && isSignedIn && (
            <Pressable
              style={({ pressed }) => [s.bioRow, pressed && { opacity: 0.75 }]}
              onPress={() => setBioMode(true)}
            >
              <Ionicons name={bio.biometricIcon} size={22} color={colors.primary} style={{ marginRight: 10 }} />
              <Text style={s.bioRowLabel}>Sign in with {bio.biometricLabel}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}

          {bioError ? <Text style={s.error}>{bioError}</Text> : null}

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="your@email.com"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            {errors.fields.identifier ? (
              <Text style={s.error}>{errors.fields.identifier.message}</Text>
            ) : null}
          </View>

          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <View style={s.passwordRow}>
              <TextInput
                style={[s.input, s.passwordInput]}
                placeholder="Enter password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
            {errors.fields.password ? (
              <Text style={s.error}>{errors.fields.password.message}</Text>
            ) : null}
          </View>

          <Pressable
            style={({ pressed }) => [
              s.button,
              pressed && s.buttonPressed,
              (isLoading || !email || !password) && s.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isLoading || !email || !password}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable>
              <Text style={s.footerLink}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    scroll: { paddingHorizontal: 24 },
    brand: { alignItems: 'center', marginBottom: 40 },
    brandPill: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 6,
      marginBottom: 10,
      alignItems: 'center',
    },
    brandLabel: {
      color: colors.primaryForeground,
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 2.5,
    },
    brandYear: {
      color: colors.primaryForeground,
      fontSize: 20,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 5,
    },
    appTagline: {
      color: colors.mutedForeground,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      letterSpacing: 0.5,
    },
    formSection: { gap: 16 },
    title: {
      fontSize: 28,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginBottom: 2,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    field: { gap: 6 },
    label: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    input: {
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.foreground,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      borderWidth: 1,
      borderColor: colors.border,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
    },
    passwordInput: {
      flex: 1,
      borderWidth: 0,
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
    },
    eyeBtn: { padding: 8 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      marginTop: 8,
    },
    buttonPressed: { opacity: 0.8 },
    buttonDisabled: { opacity: 0.45 },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
    error: {
      color: colors.destructive,
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
    },
    textLink: { alignItems: 'center', marginTop: 16 },
    textLinkLabel: {
      color: colors.primary,
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 32,
    },
    footerText: {
      color: colors.mutedForeground,
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
    footerLink: {
      color: colors.primary,
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    bioBigBtn: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    bioHint: {
      marginTop: 20,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
    },
    bioRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bioRowLabel: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.primary,
    },
  });
