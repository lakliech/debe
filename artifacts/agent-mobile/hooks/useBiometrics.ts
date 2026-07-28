/**
 * useBiometrics — wrapper around expo-local-authentication + SecureStore.
 *
 * Responsibilities:
 *  - Detect biometric hardware type (Face ID / Fingerprint) on this device
 *  - Read/write the per-account enrolled flag from SecureStore
 *  - Trigger the OS biometric prompt (biometric-only; device PIN not accepted)
 *  - Expose clear/enrol helpers for sign-in and sign-out flows
 *
 * Account-scoped preference:
 *  Pass the authenticated Clerk userId so the enrolled flag is stored as
 *  `biometric_enrolled_v1_<userId>`.  Different accounts on the same device
 *  have independent preferences; signing out from one account never grants
 *  biometric access to another.
 *
 * Loading guarantee:
 *  `loading` is derived from whether the SecureStore read for the **current**
 *  userId has completed.  When userId changes, `loading` becomes true
 *  immediately (on the same render) — no intermediate render can observe a
 *  stale `enrolled` value from the previous account.
 */
import { useCallback, useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/** Build a per-account SecureStore key. */
function enrolledKey(userId?: string | null): string {
  return userId ? `biometric_enrolled_v1_${userId}` : 'biometric_enrolled_v1';
}

/**
 * Sentinel stored as the initial `resolvedFor` value.
 * Its type is `symbol`, which can never equal `string | null | undefined`,
 * so `loading` (= resolvedFor !== userId) is always `true` until the first
 * async read completes.
 */
const UNRESOLVED = Symbol('unresolved');

export interface BiometricState {
  /** true when hardware exists and OS credentials are enrolled on the device */
  hardwareAvailable: boolean;
  /** human-readable type ("Face ID", "Fingerprint", "Biometrics") */
  biometricLabel: string;
  /** Ionicons name matching the detected type */
  biometricIcon: 'finger-print' | 'scan' | 'key-outline';
  /** true when the user has opted in for the current userId */
  enrolled: boolean;
  /**
   * true until the SecureStore read for the **current** userId completes.
   * Derived from whether resolvedFor === userId — guaranteed to be true
   * on every render where userId has changed but the async read hasn't finished.
   */
  loading: boolean;
  /** Trigger the OS biometric prompt; returns true on success. */
  authenticate: (reason?: string) => Promise<boolean>;
  /**
   * Persist the user's biometric preference.
   * Pass `explicitUserId` to write the per-account key immediately after
   * Clerk finalizes a sign-in, before useAuth() re-renders propagate the
   * new session's userId to useBiometrics.
   */
  promptEnrol: (explicitUserId?: string | null) => Promise<void>;
  /** Remove the enrolled flag — call on sign-out or when falling back to password. */
  clearEnrolment: () => Promise<void>;
}

export function useBiometrics(userId?: string | null): BiometricState {
  const [hardwareAvailable, setHardwareAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biometrics');
  const [biometricIcon, setBiometricIcon] = useState<BiometricState['biometricIcon']>('finger-print');
  const [enrolled, setEnrolled] = useState(false);

  /**
   * resolvedFor tracks which userId the current state was computed for.
   * loading = (resolvedFor !== userId) — true immediately on userId change,
   * false only after the async read for the new userId completes.
   */
  const [resolvedFor, setResolvedFor] = useState<symbol | string | null | undefined>(UNRESOLVED);
  const loading = resolvedFor !== userId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [compatible, types, storedEnrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
          SecureStore.getItemAsync(enrolledKey(userId)),
        ]);

        const hasEnrolledCreds = await LocalAuthentication.isEnrolledAsync();
        const available = compatible && hasEnrolledCreds;

        const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

        let label = 'Biometrics';
        let icon: BiometricState['biometricIcon'] = 'key-outline';
        if (hasFace) { label = 'Face ID'; icon = 'scan'; }
        else if (hasFingerprint) { label = 'Fingerprint'; icon = 'finger-print'; }

        if (!cancelled) {
          setHardwareAvailable(available);
          setBiometricLabel(label);
          setBiometricIcon(icon);
          setEnrolled(available && storedEnrolled === 'true');
          // Mark this userId as resolved — clears loading for this userId
          setResolvedFor(userId);
        }
      } catch {
        // Device may not support the API — treat as unavailable
        if (!cancelled) {
          setHardwareAvailable(false);
          setEnrolled(false);
          setResolvedFor(userId);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const authenticate = useCallback(async (reason?: string): Promise<boolean> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason ?? 'Confirm your identity',
        cancelLabel: 'Use password instead',
        // Require biometric match only — device PIN/passcode is not accepted.
        disableDeviceFallback: true,
      });
      return result.success;
    } catch {
      return false;
    }
  }, []);

  const promptEnrol = useCallback(async (explicitUserId?: string | null): Promise<void> => {
    const id = explicitUserId !== undefined ? explicitUserId : userId;
    try {
      await SecureStore.setItemAsync(enrolledKey(id), 'true');
      setEnrolled(true);
    } catch {
      // SecureStore unavailable (simulator without keychain) — ignore
    }
  }, [userId]);

  const clearEnrolment = useCallback(async (): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(enrolledKey(userId));
      setEnrolled(false);
    } catch {
      // ignore
    }
  }, [userId]);

  return {
    hardwareAvailable,
    biometricLabel,
    biometricIcon,
    enrolled,
    loading,
    authenticate,
    promptEnrol,
    clearEnrolment,
  };
}
