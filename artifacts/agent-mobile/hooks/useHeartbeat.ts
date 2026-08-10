/**
 * GPS heartbeat — while the app is open on election day, POST the agent's
 * position to /api/agent-tracking/heartbeat every 5 minutes so the campaign
 * dashboard can geofence them against their assigned station.
 *
 * Foreground-only (Expo Go can't run true background tasks); the first beat
 * fires immediately, then every 5 minutes. Entirely best-effort — failures
 * are swallowed so tracking never breaks the submission flow.
 */
import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useAuth } from '@clerk/expo';

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function useHeartbeat(enabled: boolean) {
  const { getToken } = useAuth();
  const [lastBeatAt, setLastBeatAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const beat = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (!domain) return;
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const token = await getToken();
        if (!token) return;
        await fetch(`https://${domain}/api/agent-tracking/heartbeat`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracyM: pos.coords.accuracy ?? null,
            recordedAt: new Date(pos.timestamp).toISOString(),
          }),
        });
        setLastBeatAt(new Date());
      } catch {
        // best-effort: offline, permission denied, server down — try again next tick
      } finally {
        inFlight.current = false;
      }
    };

    void beat();
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, getToken]);

  return { lastBeatAt };
}
