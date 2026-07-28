import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useBiometrics } from '@/hooks/useBiometrics';

export default function Index() {
  const { isSignedIn, isLoaded, userId } = useAuth();
  // Only read SecureStore once Clerk has resolved the userId; avoids a
  // spurious generic-key read before the account is known.
  const bio = useBiometrics(isLoaded ? userId : undefined);

  // Wait for both Clerk session resolution and the SecureStore read so we
  // never redirect to the wrong destination on cold launch.
  if (!isLoaded || bio.loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }}>
        <ActivityIndicator size="large" color="#1D9BF0" />
      </View>
    );
  }

  if (isSignedIn && bio.enrolled) {
    // Active session + biometric enrolment: route through the sign-in screen
    // so the biometric prompt is shown before any home content is accessible.
    // The sign-in screen detects this state and shows the biometric unlock UI.
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Redirect href={isSignedIn ? '/(home)' : '/(auth)/sign-in'} />;
}
