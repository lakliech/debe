import React, { useState } from 'react';
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
import { useSignUp } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

export default function SignUpScreen() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { candidateName, electionYear } = useCampaignConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');

  const isLoading = fetchStatus === 'fetching';
  const s = styles(colors);

  const handleSignUp = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: () => { router.replace('/onboarding' as never); }, // new accounts enroll first
      });
    }
  };

  // Email verification step
  if (
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0
  ) {
    return (
      <View
        style={[
          s.container,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={s.brand}>
          <View style={s.brandPill}>
            <Text style={s.brandLabel}>{candidateName.toUpperCase()}</Text>
            <Text style={s.brandYear}>{electionYear}</Text>
          </View>
        </View>

        <Text style={s.title}>Verify your email</Text>
        <Text style={s.subtitle}>
          We've sent a 6-digit code to{'\n'}
          <Text style={{ color: colors.primary }}>{email}</Text>
        </Text>

        <View style={s.codeRow}>
          <TextInput
            style={[s.input, { fontSize: 28, letterSpacing: 12, textAlign: 'center', paddingVertical: 18 }]}
            placeholder="000000"
            placeholderTextColor={colors.mutedForeground}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>

        {errors.fields.code ? (
          <Text style={s.error}>{errors.fields.code.message}</Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            s.button,
            pressed && s.buttonPressed,
            (isLoading || code.length < 6) && s.buttonDisabled,
          ]}
          onPress={handleVerify}
          disabled={isLoading || code.length < 6}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.buttonText}>Verify & continue</Text>
          )}
        </Pressable>

        <Pressable
          style={s.textLink}
          onPress={() => signUp.verifications.sendEmailCode()}
        >
          <Text style={s.textLinkLabel}>Resend code</Text>
        </Pressable>

        {/* Required for Clerk bot protection */}
        <View nativeID="clerk-captcha" />
      </View>
    );
  }

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
          <View style={s.brandPill}>
            <Text style={s.brandLabel}>{candidateName.toUpperCase()}</Text>
            <Text style={s.brandYear}>{electionYear}</Text>
          </View>
          <Text style={s.appTagline}>Field Agent Portal</Text>
        </View>

        <View style={s.formSection}>
          <Text style={s.title}>Create account</Text>
          <Text style={s.subtitle}>Join as a polling agent</Text>

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
            {errors.fields.emailAddress ? (
              <Text style={s.error}>{errors.fields.emailAddress.message}</Text>
            ) : null}
          </View>

          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <View style={s.passwordRow}>
              <TextInput
                style={[s.input, s.passwordInput]}
                placeholder="Create a password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSignUp}
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
            onPress={handleSignUp}
            disabled={isLoading || !email || !password}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.buttonText}>Create account</Text>
            )}
          </Pressable>
        </View>

        {/* Required for Clerk bot protection */}
        <View nativeID="clerk-captcha" />

        <View style={s.footer}>
          <Text style={s.footerText}>Already have an account? </Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable>
              <Text style={s.footerLink}>Sign in</Text>
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
    brand: { alignItems: 'center', marginBottom: 36 },
    brandPill: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 6,
      marginBottom: 10,
      alignItems: 'center',
    },
    brandLabel: {
      color: '#FFFFFF',
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 2.5,
    },
    brandYear: {
      color: '#FFFFFF',
      fontSize: 20,
      fontFamily: 'Inter_700Bold',
      letterSpacing: 5,
    },
    appTagline: {
      color: colors.mutedForeground,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
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
      lineHeight: 20,
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
    codeRow: { marginVertical: 16 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonPressed: { opacity: 0.8 },
    buttonDisabled: { opacity: 0.45 },
    buttonText: {
      color: '#FFFFFF',
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
  });
