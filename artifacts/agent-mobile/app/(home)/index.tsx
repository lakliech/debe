/**
 * Agent Dashboard — shows agent profile, sync status, and quick-submit entry point.
 */
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { useAuth, useUser } from '@clerk/expo';
import { useBiometrics } from '@/hooks/useBiometrics';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useOffline } from '@/context/OfflineContext';
import { useCampaignConfig } from '@/context/CampaignConfigContext';
import { useHeartbeat } from '@/hooks/useHeartbeat';

export default function Dashboard() {
  const { signOut, getToken, userId } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isOnline, pendingCount, isSyncing, syncNow, lastSyncAt, failedCount, failedQueue, clearFailedItem, saveRefCache, refCache, failedPhotoUploads, retryPhotoUpload } = useOffline();
  const bio = useBiometrics(userId);
  const { candidateName, electionYear, formName } = useCampaignConfig();

  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchWithAuth = async (path: string) => {
    const token = await getToken();
    const res = await fetch(`https://${domain}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const {
    data: agentData,
    isLoading: agentLoading,
    isError: agentError,
    refetch: refetchAgent,
  } = useQuery<{ id: string; fullName: string; status: string; trainingStatus: string; accreditationStatus: string; pollingStationId?: string }>({
    queryKey: ['agent-me'],
    queryFn: () => fetchWithAuth('/api/polling-agents/me'),
    enabled: isOnline,
    retry: 1,
    staleTime: 5 * 60_000,
  });

  // GPS heartbeat every 5 min while assigned to a station (foreground, best-effort)
  useHeartbeat(isOnline && !!agentData?.pollingStationId);

  const {
    data: stationData,
    isLoading: stationLoading,
  } = useQuery<{ id: string; name: string; code: string; registeredVoters: number } | null>({
    queryKey: ['station', agentData?.pollingStationId],
    queryFn: async () => {
      // The stations endpoint returns either { data: Station[] } or Station[]
      const raw = await fetchWithAuth(
        `/api/geography/polling-stations?search=${encodeURIComponent(agentData!.pollingStationId!)}`,
      );
      const list: { id: string; name: string; code: string; registeredVoters: number }[] =
        Array.isArray(raw) ? raw : (raw?.data ?? []);
      return list.find((s) => s.id === agentData?.pollingStationId) ?? list[0] ?? null;
    },
    enabled: !!agentData?.pollingStationId && isOnline,
    staleTime: 10 * 60_000,
  });

  const {
    data: electionsData,
  } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['active-elections'],
    queryFn: () =>
      fetchWithAuth('/api/election-admin/elections/active').catch(() => []),
    enabled: isOnline,
    staleTime: 10 * 60_000,
  });

  const activeElection = electionsData?.find((e) => e.isActive) ?? electionsData?.[0];

  // Persist reference data to AsyncStorage for offline cold starts in the form
  useEffect(() => {
    if (agentData) {
      saveRefCache({ agent: { id: agentData.id, fullName: agentData.fullName, status: agentData.status } });
    }
  }, [agentData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeElection) {
      saveRefCache({ election: activeElection });
    }
  }, [activeElection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stationData) {
      saveRefCache({
        assignedStation: {
          id: stationData.id,
          name: stationData.name,
          code: stationData.code,
          registeredVoters: stationData.registeredVoters ?? undefined,
        },
      });
    }
  }, [stationData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartSubmission = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(home)/form');
  };

  const handleViewAspirants = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(home)/aspirants');
  };

  const handleSync = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    syncNow();
  };

  const handleRetryPhotoUpload = (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    retryPhotoUpload(itemId);
    // syncNow processes all pending items; the reset item will re-attempt its photo upload
    syncNow();
  };

  const handleSignOut = async () => {
    // Clear per-account biometric enrolment before Clerk invalidates the session,
    // so a subsequent sign-in on the same device starts without inherited preferences.
    await bio.clearEnrolment();
    signOut();
  };

  const s = styleSheet(colors);
  const isRefreshing = agentLoading || stationLoading;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <View>
          <Text style={s.headerBrand}>{candidateName.toUpperCase()} {electionYear}</Text>
          <Text style={s.headerSub}>Agent Dashboard</Text>
        </View>
        <View style={s.headerRight}>
          {/* Online indicator */}
          <View style={[s.onlinePill, { backgroundColor: isOnline ? colors.success : colors.destructive }]}>
            <Ionicons
              name={isOnline ? 'wifi' : 'wifi-outline'}
              size={12}
              color={isOnline ? colors.successForeground : colors.destructiveForeground}
            />
            <Text style={[s.onlineLabel, { color: isOnline ? colors.successForeground : colors.destructiveForeground }]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
          <Pressable onPress={handleSignOut} style={s.signOutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad + 24, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refetchAgent} tintColor={colors.primary} />
        }
      >
        {/* Agent profile card */}
        <View style={s.card}>
          <View style={s.agentRow}>
            <View style={s.avatarCircle}>
              <Ionicons name="person" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              {agentLoading ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : agentError ? (
                <Text style={s.agentName}>{user?.firstName ?? 'Agent'}</Text>
              ) : (
                <>
                  <Text style={s.agentName}>{agentData?.fullName ?? user?.firstName ?? 'Agent'}</Text>
                  <View style={s.badgeRow}>
                    <StatusBadge
                      label={agentData?.status ?? 'Unknown'}
                      color={agentData?.status === 'active' ? colors.success : colors.warning}
                      textColor={agentData?.status === 'active' ? colors.successForeground : colors.warningForeground}
                    />
                    <StatusBadge
                      label={agentData?.trainingStatus ?? 'Not started'}
                      color={colors.card}
                      textColor={colors.mutedForeground}
                      border
                    />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Station assignment */}
        {agentData?.pollingStationId && (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <MaterialCommunityIcons name="map-marker-check" size={18} color={colors.primary} />
              <Text style={s.cardTitle}>Your Station</Text>
            </View>
            {stationLoading ? (
              <ActivityIndicator color={colors.primary} size="small" style={{ marginTop: 8 }} />
            ) : stationData ? (
              <>
                <Text style={s.stationName}>{stationData.name}</Text>
                <Text style={s.stationMeta}>
                  Code: {stationData.code} · {stationData.registeredVoters?.toLocaleString() ?? '—'} registered voters
                </Text>
              </>
            ) : (
              <Text style={s.stationName}>Station assigned</Text>
            )}
          </View>
        )}

        {/* Active election */}
        {activeElection && (
          <View style={[s.card, { borderColor: colors.primary, borderWidth: 1 }]}>
            <View style={s.cardHeader}>
              <Ionicons name="calendar" size={18} color={colors.primary} />
              <Text style={s.cardTitle}>Active Election</Text>
            </View>
            <Text style={s.stationName}>{activeElection.name}</Text>
            <View style={s.activePill}>
              <View style={s.activeDot} />
              <Text style={s.activeText}>Accepting submissions</Text>
            </View>
          </View>
        )}

        {/* Aspirants quick-link */}
        <Pressable
          style={({ pressed }) => [s.card, s.aspirantLink, pressed && { opacity: 0.82 }]}
          onPress={handleViewAspirants}
        >
          <View style={s.cardHeader}>
            <Ionicons name="people-outline" size={18} color={colors.primary} />
            <Text style={s.cardTitle}>Approved Aspirants</Text>
          </View>
          <Text style={s.stationName}>View aspirants in your area</Text>
          <View style={s.aspirantLinkRow}>
            <Text style={s.aspirantLinkSub}>Tap to see approved candidates running in your county</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </View>
        </Pressable>

        {/* Pending sync */}
        {pendingCount > 0 && (
          <Pressable
            style={({ pressed }) => [s.syncCard, pressed && { opacity: 0.85 }]}
            onPress={handleSync}
            disabled={isSyncing || !isOnline}
          >
            <View style={s.syncRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.syncTitle}>
                  {pendingCount} pending submission{pendingCount !== 1 ? 's' : ''}
                </Text>
                <Text style={s.syncSub}>
                  {isOnline ? 'Tap to sync now' : 'Will sync when connected'}
                </Text>
              </View>
              {isSyncing ? (
                <ActivityIndicator color={colors.warning} size="small" />
              ) : (
                <Feather name="refresh-cw" size={20} color={colors.warningForeground} />
              )}
            </View>
          </Pressable>
        )}

        {/* Last sync info */}
        {lastSyncAt && pendingCount === 0 && failedCount === 0 && (
          <Text style={s.syncedLabel}>
            All synced · Last: {lastSyncAt.toLocaleTimeString()}
          </Text>
        )}

        {/* Photo upload failures — still retryable (in pending queue) */}
        {failedPhotoUploads.length > 0 && failedPhotoUploads.map((item) => {
          // Use the item's label if set at enqueue time, otherwise fall back to
          // the cached assigned station name, then a generic fallback.
          const stationLabel =
            item.label ??
            refCache.assignedStation?.name ??
            'your station';
          return (
            <View key={item.id} style={s.photoFailBanner}>
              <View style={s.photoFailHeader}>
                <Ionicons name="warning-outline" size={18} color={colors.warningForeground} />
                <Text style={s.photoFailTitle} numberOfLines={2}>
                  ⚠ Photo for {stationLabel} could not be uploaded
                </Text>
              </View>
              <Text style={s.photoFailBody}>
                The Form 34A photo did not reach the server during the last sync.
                Reconnect and tap Retry — the submission will be sent with the photo attached.
              </Text>
              <View style={s.photoFailActions}>
                <Pressable
                  style={({ pressed }) => [s.photoFailRetryBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => handleRetryPhotoUpload(item.id)}
                  disabled={isSyncing || !isOnline}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color={colors.warningForeground} />
                  ) : (
                    <Feather name="refresh-cw" size={14} color={colors.warningForeground} />
                  )}
                  <Text style={s.photoFailRetryLabel}>
                    {isSyncing ? 'Syncing…' : isOnline ? 'Retry now' : 'Waiting for connection…'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {/* Failed submissions — require agent action */}
        {failedCount > 0 && (
          <View style={s.failedCard}>
            <View style={s.failedHeader}>
              <Ionicons name="alert-circle" size={18} color={colors.destructive} />
              <Text style={s.failedTitle}>
                {failedCount} submission{failedCount !== 1 ? 's' : ''} could not be sent
              </Text>
            </View>
            {failedQueue.map((item) => (
              <View key={item.id} style={s.failedItem}>
                <View style={{ flex: 1 }}>
                  <Text style={s.failedReason} numberOfLines={2}>
                    {item.lastError ?? 'Unknown error'}
                  </Text>
                  <Text style={s.failedTime}>
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [s.failedDismiss, pressed && { opacity: 0.7 }]}
                  onPress={() => clearFailedItem(item.id)}
                >
                  <Ionicons name="close-circle-outline" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))}
            <Text style={s.failedNote}>
              Contact your supervisor with the error details above. Dismiss only after confirming results were received through another channel.
            </Text>
          </View>
        )}

        {/* Offline warning */}
        {!isOnline && (
          <View style={s.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
            <Text style={s.offlineBannerText}>
              You're offline. You can still fill and save forms — they'll sync automatically when connected.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Submit button */}
      <View style={[s.submitBar, { paddingBottom: bottomPad + 16 }]}>
        <Pressable
          style={({ pressed }) => [s.submitBtn, pressed && { opacity: 0.88 }]}
          onPress={handleStartSubmission}
        >
          <Ionicons name="create-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={s.submitBtnText}>Start {formName} Submission</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatusBadge({
  label,
  color,
  textColor,
  border,
}: {
  label: string;
  color: string;
  textColor: string;
  border?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: color,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: border ? 1 : 0,
        borderColor: 'rgba(128,128,128,0.3)',
      }}
    >
      <Text style={{ color: textColor, fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>
        {label.replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

const styleSheet = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerBrand: {
      fontSize: 11,
      fontFamily: 'Inter_700Bold',
      color: colors.primary,
      letterSpacing: 1.5,
    },
    headerSub: {
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    onlinePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 20,
    },
    onlineLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
    signOutBtn: { padding: 4 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    agentRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatarCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.muted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    agentName: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginBottom: 6,
    },
    badgeRow: { flexDirection: 'row', gap: 6 },
    stationName: {
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    stationMeta: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    activePill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    activeDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    activeText: {
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      color: colors.success,
    },
    aspirantLink: {
      // override card gap for tighter layout
    },
    aspirantLinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    aspirantLinkSub: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    syncCard: {
      backgroundColor: colors.warning,
      borderRadius: colors.radius,
      padding: 16,
    },
    syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    syncTitle: {
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
      color: colors.warningForeground,
    },
    syncSub: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.warningForeground,
      opacity: 0.8,
    },
    syncedLabel: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
    },
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    offlineBannerText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    submitBar: {
      paddingHorizontal: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
    },
    photoFailBanner: {
      backgroundColor: colors.warning,
      borderRadius: colors.radius,
      padding: 14,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.warningForeground + '33', // 20% opacity border
    },
    photoFailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    photoFailTitle: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
      color: colors.warningForeground,
      lineHeight: 20,
    },
    photoFailBody: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.warningForeground,
      opacity: 0.85,
      lineHeight: 18,
    },
    photoFailActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
    photoFailRetryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: colors.radius,
      backgroundColor: 'rgba(0,0,0,0.12)',
    },
    photoFailRetryLabel: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: colors.warningForeground,
    },
    failedCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.destructive,
    },
    failedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    failedTitle: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
      color: colors.destructive,
    },
    failedItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    failedReason: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      lineHeight: 18,
    },
    failedTime: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginTop: 2,
    },
    failedDismiss: { padding: 4, marginTop: -2 },
    failedNote: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 16,
      fontStyle: 'italic',
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  });
