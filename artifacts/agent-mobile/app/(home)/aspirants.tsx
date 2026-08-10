/**
 * Aspirants Screen — read-only view of approved aspirants in the agent's area.
 *
 * All filtering and geography resolution is done server-side by the
 * GET /api/aspirants/agent-directory endpoint:
 *   - status=approved is hard-coded on the server; callers cannot change it
 *   - the agent's countyId is derived from their polling-station assignment;
 *     callers cannot bypass the geography restriction via query params
 *   - only public-safe fields are returned (no PII columns)
 *
 * This screen has a single data dependency and three states:
 *   loading → error (with retry) → success (list or empty)
 */
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@clerk/expo';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useOffline } from '@/context/OfflineContext';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Public-safe fields returned by /api/aspirants/agent-directory */
interface Aspirant {
  id: string;
  fullName: string;
  position: string;
  countyName: string | null;
  constituency: string | null;
  ward: string | null;
  partyAffiliation: string | null;
  isIndependent: boolean;
  status: 'approved';
  createdAt: string;
}

interface DirectoryResponse {
  data: Aspirant[];
  total: number;
  /** countyId the server resolved for this agent; null if agent has no station */
  countyId: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const POSITION_LABELS: Record<string, string> = {
  parliamentary: 'MP',
  gubernatorial: 'Governor',
  senatorial: 'Senator',
  women_rep: "Women's Rep",
  mca: 'MCA',
};

function positionLabel(pos: string) {
  return POSITION_LABELS[pos] ?? pos.replace(/_/g, ' ');
}

function positionColor(
  pos: string,
  colors: ReturnType<typeof useColors>,
): { bg: string; text: string } {
  switch (pos) {
    case 'gubernatorial':
      return { bg: colors.primary + '20', text: colors.primary };
    case 'parliamentary':
      return { bg: colors.success + '20', text: colors.success };
    case 'senatorial':
      return { bg: colors.warning + '20', text: colors.warningForeground };
    default:
      return { bg: colors.muted, text: colors.mutedForeground };
  }
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AspirantsScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isOnline } = useOffline();
  const { candidateName, electionYear } = useCampaignConfig();

  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  const fetchWithAuth = async (path: string) => {
    const token = await getToken();
    const res = await fetch(`https://${domain}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  // Single server-authoritative request: geography, status filter, and field
  // selection are all enforced on the server — not subject to client override.
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<DirectoryResponse>({
    queryKey: ['aspirants-agent-directory'],
    queryFn: () => fetchWithAuth('/api/aspirants/agent-directory'),
    enabled: isOnline,
    retry: 1,
    staleTime: 3 * 60_000,
  });

  const aspirants = data?.data ?? [];
  const isCountyScoped = !!data?.countyId;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const s = styleSheet(colors);

  // ── Offline state ─────────────────────────────────────────────────────────

  if (!isOnline) {
    return (
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <Header
          candidateName={candidateName}
          electionYear={electionYear}
          onBack={() => router.back()}
          topPad={topPad}
          colors={colors}
        />
        <View style={s.centred}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>You're offline</Text>
          <Text style={s.emptyBody}>
            Aspirant data isn't cached yet. Connect to the internet to load this list.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <Header
        candidateName={candidateName}
        electionYear={electionYear}
        onBack={() => router.back()}
        topPad={topPad}
        colors={colors}
      />

      {/* County-scoped banner — only shown when server resolved a county */}
      {isCountyScoped && (
        <View style={s.countyBanner}>
          <MaterialCommunityIcons name="map-marker-radius" size={14} color={colors.primary} />
          <Text style={s.countyBannerText} numberOfLines={1}>
            Showing approved aspirants in your county
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={s.centred}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[s.emptyBody, { marginTop: 12 }]}>Loading aspirants…</Text>
        </View>
      ) : isError ? (
        <View style={s.centred}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.destructive} />
          <Text style={s.emptyTitle}>Could not load aspirants</Text>
          <Text style={s.emptyBody}>Check your connection and try again.</Text>
          <Pressable style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={aspirants}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: bottomPad + 24,
            gap: 10,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            aspirants.length > 0 ? (
              <Text style={s.totalLabel}>
                {data?.total ?? aspirants.length} approved aspirant
                {(data?.total ?? aspirants.length) !== 1 ? 's' : ''}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.centred}>
              <MaterialCommunityIcons
                name="account-search-outline"
                size={48}
                color={colors.mutedForeground}
              />
              <Text style={s.emptyTitle}>No approved aspirants</Text>
              <Text style={s.emptyBody}>
                {isCountyScoped
                  ? 'There are no approved aspirants in your county yet.'
                  : 'No aspirants have been approved for this campaign yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <AspirantCard aspirant={item} colors={colors} s={s} />
          )}
        />
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({
  candidateName,
  electionYear,
  onBack,
  topPad,
  colors,
}: {
  candidateName: string;
  electionYear: number;
  onBack: () => void;
  topPad: number;
  colors: ReturnType<typeof useColors>;
}) {
  const s = styleSheet(colors);
  return (
    <View style={[s.header, { paddingTop: topPad + 12 }]}>
      <Pressable onPress={onBack} style={s.backBtn} hitSlop={10}>
        <Ionicons name="arrow-back" size={22} color={colors.foreground} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={s.headerBrand}>{candidateName.toUpperCase()} {electionYear}</Text>
        <Text style={s.headerSub}>Approved Aspirants</Text>
      </View>
    </View>
  );
}

function AspirantCard({
  aspirant,
  colors,
  s,
}: {
  aspirant: Aspirant;
  colors: ReturnType<typeof useColors>;
  s: ReturnType<typeof styleSheet>;
}) {
  const pos = positionColor(aspirant.position, colors);
  const geo = [aspirant.constituency, aspirant.countyName].filter(Boolean).join(' · ');

  return (
    <View style={s.card}>
      {/* Name + position row */}
      <View style={s.cardNameRow}>
        <View style={s.avatarCircle}>
          <Ionicons name="person-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.aspirantName} numberOfLines={2}>{aspirant.fullName}</Text>
          {geo ? (
            <Text style={s.aspirantGeo} numberOfLines={1}>{geo}</Text>
          ) : null}
        </View>
        <View style={[s.posBadge, { backgroundColor: pos.bg }]}>
          <Text style={[s.posBadgeText, { color: pos.text }]}>
            {positionLabel(aspirant.position)}
          </Text>
        </View>
      </View>

      {/* Detail chips */}
      <View style={s.detailRow}>
        {aspirant.partyAffiliation ? (
          <DetailChip icon="flag-outline" label={aspirant.partyAffiliation} colors={colors} s={s} />
        ) : aspirant.isIndependent ? (
          <DetailChip icon="person-circle-outline" label="Independent" colors={colors} s={s} />
        ) : null}
        {aspirant.ward ? (
          <DetailChip icon="location-outline" label={aspirant.ward} colors={colors} s={s} />
        ) : null}
      </View>
    </View>
  );
}

function DetailChip({
  icon,
  label,
  colors,
  s,
}: {
  icon: string;
  label: string;
  colors: ReturnType<typeof useColors>;
  s: ReturnType<typeof styleSheet>;
}) {
  return (
    <View style={s.chip}>
      <Ionicons name={icon as any} size={12} color={colors.mutedForeground} />
      <Text style={s.chipText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styleSheet = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: { padding: 2 },
    headerBrand: {
      fontSize: 10,
      fontFamily: 'Inter_700Bold',
      color: colors.primary,
      letterSpacing: 1.5,
    },
    headerSub: {
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    countyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.primary + '12',
      borderBottomWidth: 1,
      borderBottomColor: colors.primary + '25',
    },
    countyBannerText: {
      flex: 1,
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      color: colors.primary,
    },
    centred: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 8,
    },
    emptyTitle: {
      fontSize: 17,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      textAlign: 'center',
      marginTop: 8,
    },
    emptyBody: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 20,
    },
    retryBtn: {
      marginTop: 12,
      paddingHorizontal: 24,
      paddingVertical: 10,
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
    },
    retryBtnText: {
      color: '#fff',
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    totalLabel: {
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 10,
    },
    cardNameRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary + '18',
      justifyContent: 'center',
      alignItems: 'center',
    },
    aspirantName: {
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      lineHeight: 20,
      marginBottom: 2,
    },
    aspirantGeo: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    posBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      alignSelf: 'flex-start',
      flexShrink: 0,
    },
    posBadgeText: {
      fontSize: 11,
      fontFamily: 'Inter_600SemiBold',
    },
    detailRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.muted,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 20,
      maxWidth: 180,
    },
    chipText: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      flexShrink: 1,
    },
  });
