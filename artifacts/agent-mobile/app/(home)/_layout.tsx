import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@clerk/expo';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { OfflineProvider } from '@/context/OfflineContext';
import { useBiometrics } from '@/hooks/useBiometrics';
import { useColors } from '@/hooks/useColors';
import { bioSessionState } from '@/utils/bioSessionState';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

/**
 * Minimum time (ms) the app must be in the background before we require
 * a fresh biometric confirmation on return.
 */
const BIO_LOCK_AFTER_MS = 5 * 60 * 1000;

export default function HomeLayout() {
  const { isSignedIn, userId, getToken } = useAuth();
  const router = useRouter();
  /**
   * userId is the authenticated Clerk user ID — guaranteed to be correct
   * here because this layout only mounts when isSignedIn is true.
   * Passing it to useBiometrics scopes the enrolled flag to this account.
   */
  const bio = useBiometrics(userId);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { candidateName, electionYear } = useCampaignConfig();

  /**
   * undefined → still waiting for SecureStore read (show spinner, no content)
   * true      → biometric lock is active (show overlay)
   * false     → user is authenticated (show home content)
   */
  const [biometricLocked, setBiometricLocked] = useState<boolean | undefined>(undefined);
  const [bioError, setBioError] = useState('');
  const backgroundedAt = useRef<number | null>(null);

  /**
   * Enrollment offer modal — shown once after a fresh password/MFA sign-in
   * when the device has biometric hardware available.  Rendered here (not on
   * the sign-in screen) so that userId from useAuth() is already the correct
   * authenticated value when the agent taps "Enable".
   */
  const [showEnrolModal, setShowEnrolModal] = useState(false);

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  // ── Initialise lock + enrollment offer once SecureStore has resolved ───────
  useEffect(() => {
    if (!bio.loading) {
      // consumeBypass() is true once when the sign-in screen just completed
      // authentication — skip the initial lock because the user already proved
      // their identity there.
      const justAuthenticated = bioSessionState.consumeBypass();
      setBiometricLocked(!justAuthenticated && bio.enrolled);

      // consumeOfferEnrollment() is true once when the sign-in screen detected
      // hardware is available but not yet enrolled.  Show the offer now because
      // userId (the correct per-account key) is available in this layout.
      if (justAuthenticated && bioSessionState.consumeOfferEnrollment()) {
        setShowEnrolModal(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bio.loading]);

  // ── Re-lock when returning from a long background stint ───────────────────
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'background' || nextState === 'inactive') {
          backgroundedAt.current = Date.now();
        } else if (nextState === 'active' && backgroundedAt.current !== null) {
          const elapsed = Date.now() - backgroundedAt.current;
          backgroundedAt.current = null;
          if (bio.enrolled && elapsed >= BIO_LOCK_AFTER_MS) {
            setBiometricLocked(true);
            setBioError('');
          }
        }
      }
    );
    return () => subscription.remove();
  }, [bio.enrolled]);

  // ── Biometric unlock handler ──────────────────────────────────────────────
  const handleUnlock = useCallback(async () => {
    setBioError('');
    const ok = await bio.authenticate(`Unlock ${candidateName} Agent`);
    if (ok) {
      setBiometricLocked(false);
    } else {
      setBioError('Authentication failed. Please try again.');
    }
  }, [bio]);

  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  // Still reading SecureStore — keep content hidden to avoid lock-flicker
  if (biometricLocked === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1D9BF0" />
      </View>
    );
  }

  const s = styles(colors);

  return (
    <OfflineProvider>
      {/* ── Biometric enrollment offer modal ─────────────────────────────── */}
      <Modal
        visible={showEnrolModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEnrolModal(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Ionicons
              name={bio.biometricIcon}
              size={48}
              color={colors.primary}
              style={{ marginBottom: 16 }}
            />
            <Text style={s.modalTitle}>Sign in faster?</Text>
            <Text style={s.modalBody}>
              Use {bio.biometricLabel} to unlock the app next time — no password needed.
            </Text>
            <Pressable
              style={({ pressed }) => [s.button, pressed && s.buttonPressed, { marginTop: 20 }]}
              onPress={async () => {
                // userId is the authenticated Clerk user ID here (home layout
                // only mounts when isSignedIn is true), so the per-account
                // SecureStore key is written correctly.
                await bio.promptEnrol(userId);
                setShowEnrolModal(false);
              }}
            >
              <Ionicons
                name={bio.biometricIcon}
                size={18}
                color={colors.primaryForeground}
                style={{ marginRight: 8 }}
              />
              <Text style={s.buttonText}>Enable {bio.biometricLabel}</Text>
            </Pressable>
            <Pressable
              style={[s.textLink, { marginTop: 12 }]}
              onPress={() => setShowEnrolModal(false)}
            >
              <Text style={s.textLinkLabel}>Skip for now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Biometric lock overlay ────────────────────────────────────────── */}
      {biometricLocked && (
        <View style={[s.lockOverlay, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}>
          <View style={s.lockContent}>
            <View style={s.brandPill}>
              <Text style={s.brandLabel}>{candidateName.toUpperCase()}</Text>
              <Text style={s.brandYear}>{electionYear}</Text>
            </View>
            <Text style={s.lockTitle}>Session locked</Text>
            <Text style={s.lockSubtitle}>Authenticate to continue</Text>

            <Pressable
              style={({ pressed }) => [s.bioBigBtn, pressed && { opacity: 0.75 }]}
              onPress={handleUnlock}
              accessibilityLabel={`Unlock with ${bio.biometricLabel}`}
              accessibilityRole="button"
            >
              <Ionicons name={bio.biometricIcon} size={52} color={colors.primaryForeground} />
            </Pressable>

            <Text style={s.bioHint}>Tap to unlock with {bio.biometricLabel}</Text>

            {bioError ? <Text style={s.error}>{bioError}</Text> : null}

            {/* Password fallback — clears biometric enrollment so the sign-in
                screen shows the password form, then the agent can re-enroll
                after a successful password authentication. */}
            <Pressable
              style={({ pressed }) => [s.textLink, pressed && { opacity: 0.65 }, { marginTop: 28 }]}
              onPress={async () => {
                await bio.clearEnrolment();
                router.replace('/(auth)/sign-in');
              }}
            >
              <Text style={s.textLinkLabel}>Use password instead</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="form"
          options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
        />
      </Stack>
    </OfflineProvider>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    lockOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 9999,
      backgroundColor: colors.background,
      alignItems: 'center',
    },
    lockContent: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 32,
    },
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
    lockTitle: {
      fontSize: 24,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginTop: 32,
      marginBottom: 6,
    },
    lockSubtitle: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginBottom: 48,
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
    error: {
      marginTop: 16,
      color: colors.destructive,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      textAlign: 'center',
    },
    // ── Enrollment modal ──────────────────────────────────────────────────
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: colors.card,
      borderRadius: (colors.radius ?? 8) * 2,
      padding: 32,
      alignItems: 'center',
      width: '100%',
      maxWidth: 360,
    },
    modalTitle: {
      fontSize: 22,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginBottom: 10,
      textAlign: 'center',
    },
    modalBody: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 20,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      width: '100%',
    },
    buttonPressed: { opacity: 0.8 },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
    },
    textLink: { alignItems: 'center' },
    textLinkLabel: {
      color: colors.primary,
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
    },
  });
