/**
 * Multi-step Form 34A submission screen.
 * Steps: station → ballot → candidates → photo → observations → review
 * Fully offline-capable: drafts saved to AsyncStorage, submissions queued.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useOffline, type Draft, type CandidateVote } from '@/context/OfflineContext';
import { useCampaignConfig } from '@/context/CampaignConfigContext';

type Step = 'station' | 'ballot' | 'candidates' | 'photo' | 'observations' | 'review';

const STEPS: Step[] = ['station', 'ballot', 'candidates', 'photo', 'observations', 'review'];
const STEP_LABELS: Record<Step, string> = {
  station: 'Station',
  ballot: 'Ballot',
  candidates: 'Candidates',
  photo: 'Photo',
  observations: 'Observations',
  review: 'Review',
};

interface Candidate {
  id: string;
  fullName: string;
  partyAbbreviation?: string;
}

export default function FormScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { draft, setDraft, updateDraft, clearDraft, enqueueItem, isOnline, deviceId, refCache, saveRefCache } = useOffline();
  const { formName } = useCampaignConfig();
  const s = styles(colors);

  const [step, setStep] = useState<Step>('station');
  const [stationCode, setStationCode] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoSizeBytes, setPhotoSizeBytes] = useState<number | null>(null);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const stepIndex = STEPS.indexOf(step);

  const fetchWithAuth = useCallback(
    async (path: string) => {
      const token = await getToken();
      const res = await fetch(`https://${domain}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [getToken, domain],
  );

  /**
   * Upload a local photo URI to object storage.
   * Returns the objectPath on success, or null if the upload fails.
   * The returned path is passed as `formPhotoUrl` in the submission payload
   * so the server can register it in submission_form_images.
   *
   * sizeBytes is hinted to the server so it can reject oversized uploads
   * before a single byte is transferred to storage.
   */
  const uploadFormPhoto = useCallback(
    async (photoUri: string, sizeBytes?: number): Promise<string | null> => {
      try {
        const token = await getToken();
        // Step 1: get a short-lived presigned PUT URL; hint the size so the
        // server can reject oversized payloads before the PUT begins.
        const urlRes = await fetch(`https://${domain}/api/election-results/photo-upload-url`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sizeBytes !== undefined ? { sizeBytes } : {}),
        });
        if (!urlRes.ok) return null;
        const { uploadUrl, objectPath } = await urlRes.json() as { uploadUrl: string; objectPath: string };
        // Step 2: read the local photo as a blob
        const photoRes = await fetch(photoUri);
        if (!photoRes.ok) return null;
        const blob = await photoRes.blob();
        // Step 3: PUT directly to GCS — no API server involved
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': 'image/jpeg' },
        });
        return putRes.ok ? objectPath : null;
      } catch {
        return null;
      }
    },
    [getToken, domain],
  );

  // Fetch active election — fall back to cached data when offline
  const { data: elections } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['active-elections'],
    queryFn: () => fetchWithAuth('/api/election-admin/elections/active').catch(() => []),
    enabled: isOnline,
    staleTime: 10 * 60_000,
  });
  const activeElection = elections?.find((e) => e.isActive) ?? elections?.[0];
  // Merge live data with cached data — allows offline cold starts
  const resolvedElection = activeElection ?? refCache.election;

  // Fetch agent info — fall back to cached data when offline
  const { data: agentData } = useQuery<{ id: string; fullName: string }>({
    queryKey: ['agent-me'],
    queryFn: () => fetchWithAuth('/api/polling-agents/me'),
    enabled: isOnline,
    retry: 1,
    staleTime: 10 * 60_000,
  });
  const resolvedAgent = agentData ?? refCache.agent;

  // Fetch candidates when election is known and online
  const { data: candidates, isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: ['candidates', draft?.electionId],
    queryFn: () => fetchWithAuth(`/api/election-admin/elections/${draft!.electionId}/candidates`),
    enabled: !!draft?.electionId && isOnline,
    staleTime: 10 * 60_000,
  });

  // Persist candidates to refCache when fetched so they're available offline
  useEffect(() => {
    if (candidates && draft?.electionId) {
      saveRefCache({
        candidates: candidates.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          partyAbbreviation: c.partyAbbreviation,
        })),
        candidatesForElection: draft.electionId,
      });
    }
  }, [candidates, draft?.electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve candidates: live first, then cached (for offline cold starts)
  const resolvedCandidates: Candidate[] | undefined =
    candidates ??
    (refCache.candidatesForElection === draft?.electionId && refCache.candidates
      ? refCache.candidates
      : undefined);

  // When candidates arrive (live or cached), seed them into the draft
  useEffect(() => {
    if (!resolvedCandidates || !draft) return;
    const existing = Object.keys(draft.candidateVotes);
    if (existing.length === 0 || existing.length !== resolvedCandidates.length) {
      const votes: Record<string, CandidateVote> = {};
      for (const c of resolvedCandidates) {
        votes[c.id] = {
          name: c.fullName,
          party: c.partyAbbreviation,
          votes: draft.candidateVotes[c.id]?.votes ?? 0,
        };
      }
      updateDraft({ candidateVotes: votes });
    }
  }, [resolvedCandidates?.length, draft?.electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Draft creation helper ────────────────────────────────────────────────
  /** Creates a new draft from a station + resolved election/agent data. */
  const initDraftWithStation = async (station: {
    id: string;
    name?: string;
    code?: string;
    registeredVoters?: number;
  }) => {
    const election = resolvedElection;
    const agent = resolvedAgent;
    if (!election?.id || !agent?.id) {
      Alert.alert(
        'Profile not loaded',
        'Your agent profile and election data must be loaded at least once while online before starting an offline submission.',
      );
      return;
    }

    let gpsLat: number | undefined;
    let gpsLon: number | undefined;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (loc) { gpsLat = loc.coords.latitude; gpsLon = loc.coords.longitude; }
    }

    const newDraft: Draft = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 8),
      stationId: station.id,
      stationName: station.name,
      stationCode: station.code,
      electionId: election.id,
      agentId: agent.id,
      candidateVotes: {},
      agentSigned: false,
      agentReceivedCopy: false,
      resultsDisplayed: false,
      objectionRaised: false,
      deviceId,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gpsLat,
      gpsLon,
    };
    setDraft(newDraft);
    setStep('ballot');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ─── Station lookup ────────────────────────────────────────────────────────
  const handleLookupStation = async () => {
    if (!stationCode.trim()) return;

    if (!isOnline) {
      // Offline path: match against cached recent stations or assigned station
      const needle = stationCode.trim().toLowerCase();
      const cachedHit =
        refCache.recentStations?.find(
          (s) => s.code.toLowerCase() === needle || s.name.toLowerCase().includes(needle),
        ) ??
        (refCache.assignedStation &&
          (refCache.assignedStation.code.toLowerCase() === needle ||
            refCache.assignedStation.name.toLowerCase().includes(needle))
          ? refCache.assignedStation
          : null);

      if (cachedHit) {
        await initDraftWithStation(cachedHit);
      } else {
        Alert.alert(
          'No connection',
          'Station lookup requires internet. Use your assigned station below, or enter its code and connect to confirm.',
        );
      }
      return;
    }

    setLookingUp(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `https://${domain}/api/geography/polling-stations?search=${encodeURIComponent(stationCode)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json() as Record<string, unknown>;
      const list = (Array.isArray(data) ? data : (data?.data ?? [])) as {
        id: string; name: string; code: string; registeredVoters?: number;
      }[];
      const station = list[0];
      if (!station) {
        Alert.alert('Not found', 'No polling station matched that code or name.');
        return;
      }

      // Cache station for future offline use
      const cached = { id: station.id, name: station.name, code: station.code, registeredVoters: station.registeredVoters };
      saveRefCache({
        recentStations: [cached, ...(refCache.recentStations ?? []).filter((s) => s.id !== station.id)].slice(0, 5),
      });

      await initDraftWithStation(station);
    } catch {
      Alert.alert('Error', 'Failed to look up the station. Please try again.');
    } finally {
      setLookingUp(false);
    }
  };

  /** Use the cached assigned station directly (available offline). */
  const handleUseAssignedStation = async () => {
    const station = refCache.assignedStation;
    if (!station) return;
    await initDraftWithStation(station);
  };

  // ─── Camera ───────────────────────────────────────────────────────────────
  /** Maximum pixels on the long edge. Keeps legibility while limiting upload size. */
  const MAX_LONG_EDGE = 2000;

  const handleCapturePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera required',
        `Please allow camera access to photograph ${formName}.`,
        Platform.OS !== 'web' ? [{ text: 'OK' }] : undefined,
      );
      return;
    }
    // Capture at full quality without EXIF — we apply our own compression below.
    const result = await ImagePicker.launchCameraAsync({
      quality: 1,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];

      // Resize to max 2000 px on the long edge then recompress to JPEG 0.75.
      // This cuts typical upload sizes from ~5 MB to ~300 KB without losing
      // legibility of form text, protecting agents on metered data plans.
      const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
      const resizeActions: ImageManipulator.Action[] =
        longEdge > MAX_LONG_EDGE
          ? [(asset.width ?? 0) >= (asset.height ?? 0)
              ? { resize: { width: MAX_LONG_EDGE } }
              : { resize: { height: MAX_LONG_EDGE } }]
          : [];

      const compressed = await ImageManipulator.manipulateAsync(
        asset.uri,
        resizeActions,
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      // Measure compressed size so it can be shown in the UI and hinted to the server.
      try {
        const blob = await fetch(compressed.uri).then((r) => r.blob());
        setPhotoSizeBytes(blob.size);
      } catch {
        setPhotoSizeBytes(null);
      }

      updateDraft({ photoUri: compressed.uri });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // ─── Validation ───────────────────────────────────────────────────────────
  const candidateTotal = draft
    ? Object.values(draft.candidateVotes).reduce((s, v) => s + (v.votes || 0), 0)
    : 0;

  const validationFlags: string[] = [];
  if (draft) {
    if (
      draft.totalValidVotes !== undefined &&
      candidateTotal !== draft.totalValidVotes
    ) {
      validationFlags.push(`Candidate total (${candidateTotal}) ≠ valid votes (${draft.totalValidVotes})`);
    }
    if (
      draft.totalVotesCast !== undefined &&
      draft.registeredVoters !== undefined &&
      draft.totalVotesCast > draft.registeredVoters
    ) {
      validationFlags.push('Votes cast exceeds registered voters');
    }
    const recon =
      (draft.totalVotesCast ?? 0) +
      (draft.unusedBallots ?? 0) +
      (draft.spoiltBallots ?? 0) +
      (draft.rejectedBallots ?? 0);
    if (draft.ballotsIssued !== undefined && draft.ballotsIssued !== 0 && recon !== draft.ballotsIssued) {
      validationFlags.push(`Ballot reconciliation: ${recon} ≠ ${draft.ballotsIssued} issued`);
    }
    if (!draft.photoUri) {
      validationFlags.push(`No ${formName} photo captured (required)`);
    }
  }

  // ─── Submission ───────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!draft) return;
    // Guard: electionId and agentId must be non-empty UUIDs — drafts created
    // before these were loaded would produce server-side validation failures.
    if (!draft.electionId || !draft.agentId) {
      Alert.alert(
        'Incomplete draft',
        'This draft is missing election or agent information. Please start a new submission.',
      );
      return;
    }
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Upload Form 34A photo to object storage before submitting (online only).
    // If upload fails, fall through to the queue so the photo can be retried —
    // we never submit a Form 34A without its photo evidence.
    let formPhotoUrl: string | undefined;
    let photoUploadFailed = false;
    if (draft.photoUri && isOnline) {
      setUploadingPhoto(true);
      formPhotoUrl = (await uploadFormPhoto(draft.photoUri, photoSizeBytes ?? undefined)) ?? undefined;
      setUploadingPhoto(false);
      if (!formPhotoUrl) photoUploadFailed = true;
    }

    const payload = {
      pollingStationId: draft.stationId,
      electionId: draft.electionId,
      agentId: draft.agentId,
      registeredVoters: draft.registeredVoters,
      ballotsIssued: draft.ballotsIssued,
      unusedBallots: draft.unusedBallots,
      spoiltBallots: draft.spoiltBallots,
      rejectedBallots: draft.rejectedBallots,
      totalVotesCast: draft.totalVotesCast,
      totalValidVotes: draft.totalValidVotes,
      agentSigned: draft.agentSigned,
      agentReceivedCopy: draft.agentReceivedCopy,
      resultsDisplayed: draft.resultsDisplayed,
      objectionRaised: draft.objectionRaised,
      agentComments: draft.agentComments,
      gpsLat: draft.gpsLat,
      gpsLon: draft.gpsLon,
      offlineCapturedAt: draft.capturedAt,
      deviceId: draft.deviceId,
      candidateVotes: Object.entries(draft.candidateVotes).map(([candidateId, v]) => ({
        candidateId,
        candidateName: v.name,
        partyAbbreviation: v.party,
        voteCount: v.votes,
      })),
      ...(formPhotoUrl ? { formPhotoUrl } : {}),
    };

    const endpoint = '/api/election-results/submissions/agent-submit';

    // Skip online submission when photo upload failed — let the queue handle retry
    if (isOnline && !photoUploadFailed) {
      try {
        const token = await getToken();
        const res = await fetch(`https://${domain}${endpoint}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          // Server confirmed — safe to clear draft
          const result = await res.json() as { submission?: { id?: string } };
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSubmitResult({ success: true, message: `Ref: ${result.submission?.id ?? 'recorded'}` });
          await clearDraft();
          setSubmitting(false);
          return;
        }

        if (res.status >= 400 && res.status < 500) {
          // Non-retryable: validation / auth error — surface it to the agent
          // and keep the draft intact so they can correct and resubmit.
          const errBody = await res.json().catch(() => ({})) as Record<string, string>;
          const message = errBody?.error ?? errBody?.message ?? `Submission rejected (HTTP ${res.status})`;
          Alert.alert(
            'Submission rejected',
            `${message}\n\nYour draft has been kept. Please review your entries and try again.`,
          );
          setSubmitting(false);
          return;
        }
        // 5xx: retryable server error — fall through to queue
      } catch {
        // Network error — fall through to queue
      }
    }

    // Queue for background sync (only on 5xx or network failure).
    // Draft is intentionally NOT cleared — it stays in AsyncStorage as a
    // recoverable copy. OfflineContext.syncNow clears it automatically when
    // the queued item is confirmed by the server (matched via queueItemId).
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 8);
    await enqueueItem({
      id: queueId,
      payload: {
        endpoint,
        method: 'POST',
        body: payload,
        // If photo wasn't uploaded yet (offline or upload failed), carry the
        // local URI so OfflineContext can upload it before the next sync attempt.
        ...(!formPhotoUrl && draft.photoUri ? { pendingPhotoUri: draft.photoUri } : {}),
      },
      attempts: 0,
      createdAt: new Date().toISOString(),
      // Station name label — used by the photo-failure warning banner on the
      // dashboard to show "Photo for <station> could not be uploaded".
      label: draft.stationName,
    });
    // Tag the draft so the context can clear it on successful sync
    updateDraft({ queueItemId: queueId });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setSubmitResult({
      success: true,
      message: photoUploadFailed
        ? 'Photo upload failed — queued for retry. Will sync automatically when connected.'
        : isOnline
        ? 'Server error — queued for retry. Will sync automatically.'
        : 'Saved offline — will sync automatically when connected.',
    });
    setSubmitting(false);
  };

  const handleClose = () => router.back();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // ─── Success screen ───────────────────────────────────────────────────────
  if (submitResult?.success) {
    return (
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View style={[s.successScreen, { paddingTop: topPad + 60, paddingBottom: bottomPad + 40 }]}>
          <View style={s.successIconCircle}>
            <Ionicons name="checkmark" size={52} color="#FFFFFF" />
          </View>
          <Text style={s.successTitle}>Submitted!</Text>
          <Text style={s.successSub}>{submitResult.message}</Text>
          <Text style={s.successNote}>
            The auto-validation system will process your submission and your supervisor will be notified.
          </Text>
          <Pressable
            style={({ pressed }) => [s.doneBtn, pressed && { opacity: 0.85 }]}
            onPress={handleClose}
          >
            <Text style={s.doneBtnText}>Back to Dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={handleClose} style={s.closeBtn}>
          <Ionicons name="close" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerTitle}>{formName} Submission</Text>
          <Text style={s.headerSub}>{STEP_LABELS[step]} · {stepIndex + 1}/{STEPS.length}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Step progress bar */}
      <View style={s.progressRow}>
        {STEPS.map((st, i) => (
          <View
            key={st}
            style={[
              s.progressDot,
              i <= stepIndex ? { backgroundColor: colors.primary } : { backgroundColor: colors.border },
            ]}
          />
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── STEP: Station ──────────────────────────────────────────────── */}
        {step === 'station' && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Find Your Station</Text>
            <Text style={s.stepSub}>Enter the polling station code or name to begin.</Text>

            {/* Assigned station shortcut — works offline */}
            {refCache.assignedStation && (
              <Pressable
                style={({ pressed }) => [s.assignedStationCard, pressed && { opacity: 0.88 }]}
                onPress={handleUseAssignedStation}
              >
                <MaterialCommunityIcons name="map-marker-check" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.assignedStationLabel}>Your assigned station</Text>
                  <Text style={s.assignedStationName}>{refCache.assignedStation.name}</Text>
                  <Text style={s.assignedStationCode}>{refCache.assignedStation.code}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              </Pressable>
            )}

            {/* Divider */}
            {refCache.assignedStation && (
              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>or search</Text>
                <View style={s.dividerLine} />
              </View>
            )}

            {/* Search — available online; offline shows cached matches */}
            <View style={s.searchRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="Station code or name…"
                placeholderTextColor={colors.mutedForeground}
                value={stationCode}
                onChangeText={setStationCode}
                returnKeyType="search"
                onSubmitEditing={handleLookupStation}
              />
              <Pressable
                style={({ pressed }) => [
                  s.searchBtn,
                  pressed && { opacity: 0.85 },
                  (!stationCode.trim() || lookingUp) && { opacity: 0.5 },
                ]}
                onPress={handleLookupStation}
                disabled={!stationCode.trim() || lookingUp}
              >
                {lookingUp ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Feather name="search" size={20} color="#FFFFFF" />
                )}
              </Pressable>
            </View>

            {!isOnline && (
              <View style={s.warnBanner}>
                <Ionicons name="wifi-outline" size={16} color={colors.warning} />
                <Text style={s.warnText}>
                  You're offline. Use your assigned station above, or enter a station code that was previously searched.
                </Text>
              </View>
            )}

            {resolvedElection && (
              <View style={s.infoBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
                <Text style={s.infoText}>
                  Active election: <Text style={{ fontFamily: 'Inter_600SemiBold' }}>{resolvedElection.name}</Text>
                  {!isOnline ? ' (cached)' : ''}
                </Text>
              </View>
            )}

            {!resolvedElection && !resolvedAgent && (
              <View style={s.warnBanner}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                <Text style={[s.warnText, { color: colors.destructive }]}>
                  No cached data available. Please connect to the internet at least once to load your profile and election information.
                </Text>
              </View>
            )}

            {draft && (
              <Pressable
                style={({ pressed }) => [s.continueBtn, pressed && { opacity: 0.85 }]}
                onPress={() => setStep('ballot')}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={s.continueBtnText}>Continue existing draft: {draft.stationName}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Station info banner (shown after station step) */}
        {draft && step !== 'station' && (
          <View style={s.stationBanner}>
            <MaterialCommunityIcons name="map-marker" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.stationBannerName}>{draft.stationName}</Text>
              <Text style={s.stationBannerCode}>{draft.stationCode}</Text>
            </View>
          </View>
        )}

        {/* ── STEP: Ballot Accounting ────────────────────────────────────── */}
        {step === 'ballot' && draft && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Ballot Accounting</Text>
            <Text style={s.stepSub}>Enter figures from {formName} exactly as printed.</Text>
            {(
              [
                ['registeredVoters', 'Registered Voters'],
                ['ballotsReceived', 'Ballots Received'],
                ['ballotsIssued', 'Ballots Issued'],
                ['unusedBallots', 'Unused Ballots'],
                ['spoiltBallots', 'Spoilt Ballots'],
                ['rejectedBallots', 'Rejected Ballots'],
                ['totalVotesCast', 'Total Votes Cast'],
                ['totalValidVotes', 'Total Valid Votes'],
              ] as [keyof Draft, string][]
            ).map(([field, label]) => (
              <View key={field} style={s.numberField}>
                <Text style={s.fieldLabel}>{label}</Text>
                <TextInput
                  style={[s.input, s.numberInput]}
                  keyboardType="number-pad"
                  value={draft[field as keyof Draft] != null ? String(draft[field as keyof Draft]) : ''}
                  onChangeText={(v) =>
                    updateDraft({ [field]: v === '' ? undefined : parseInt(v, 10) })
                  }
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            ))}
          </View>
        )}

        {/* ── STEP: Candidate Votes ──────────────────────────────────────── */}
        {step === 'candidates' && draft && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Candidate Votes</Text>
            <Text style={s.stepSub}>Enter votes per candidate from {formName}.</Text>

            {candidatesLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            ) : Object.keys(draft.candidateVotes).length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="people-outline" size={32} color={colors.mutedForeground} />
                <Text style={s.emptyText}>
                  {isOnline
                    ? 'Loading candidates…'
                    : refCache.candidatesForElection === draft.electionId
                      ? 'Loading candidates from cache…'
                      : 'No candidate data available offline. Please connect to internet while on this election\'s form to cache candidates for future offline use.'}
                </Text>
              </View>
            ) : (
              Object.entries(draft.candidateVotes).map(([candidateId, v]) => (
                <View key={candidateId} style={s.candidateRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.candidateName}>{v.name}</Text>
                    {v.party ? <Text style={s.candidateParty}>{v.party}</Text> : null}
                  </View>
                  <TextInput
                    style={[s.input, s.votesInput]}
                    keyboardType="number-pad"
                    value={v.votes ? String(v.votes) : ''}
                    onChangeText={(val) =>
                      updateDraft({
                        candidateVotes: {
                          ...draft.candidateVotes,
                          [candidateId]: { ...v, votes: parseInt(val, 10) || 0 },
                        },
                      })
                    }
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              ))
            )}

            {/* Total row */}
            {Object.keys(draft.candidateVotes).length > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>CANDIDATE TOTAL</Text>
                <Text
                  style={[
                    s.totalValue,
                    candidateTotal !== (draft.totalValidVotes ?? candidateTotal)
                      ? { color: colors.destructive }
                      : { color: colors.success },
                  ]}
                >
                  {candidateTotal.toLocaleString()}
                </Text>
              </View>
            )}
            {draft.totalValidVotes !== undefined && candidateTotal !== draft.totalValidVotes && (
              <View style={s.warnBanner}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                <Text style={s.warnText}>
                  Candidate total doesn't match Total Valid Votes ({draft.totalValidVotes}). You can still continue.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── STEP: Photo ────────────────────────────────────────────────── */}
        {step === 'photo' && draft && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Photograph {formName}</Text>
            <Text style={s.stepSub}>Take a clear photo of the signed {formName} as evidence.</Text>

            {draft.photoUri ? (
              <View style={s.photoContainer}>
                <Image source={{ uri: draft.photoUri }} style={s.photo} resizeMode="cover" />
                {photoSizeBytes !== null && (
                  <View style={s.photoSizeBadge}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <Text style={s.photoSizeText}>
                      {photoSizeBytes < 1024 * 1024
                        ? `~${Math.round(photoSizeBytes / 1024)} KB`
                        : `~${(photoSizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                      {' · compressed'}
                    </Text>
                  </View>
                )}
                <Pressable
                  style={({ pressed }) => [s.retakeBtn, pressed && { opacity: 0.85 }]}
                  onPress={handleCapturePhoto}
                >
                  <Ionicons name="camera-outline" size={18} color={colors.primary} />
                  <Text style={s.retakeBtnText}>Retake photo</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [s.cameraCard, pressed && { opacity: 0.85 }]}
                onPress={handleCapturePhoto}
              >
                <View style={s.cameraIconCircle}>
                  <Ionicons name="camera-outline" size={40} color={colors.primary} />
                </View>
                <Text style={s.cameraTitle}>Take Photo</Text>
                <Text style={s.cameraSub}>
                  Tap to open camera and photograph the completed {formName}
                </Text>
              </Pressable>
            )}

            <View style={s.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={s.infoText}>
                The photo is saved to your device. You can proceed without a photo but it's strongly recommended.
              </Text>
            </View>
          </View>
        )}

        {/* ── STEP: Observations ─────────────────────────────────────────── */}
        {step === 'observations' && draft && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Observations</Text>
            <Text style={s.stepSub}>Record what happened at the polling station.</Text>

            {(
              [
                ['agentSigned', `I signed ${formName}`],
                ['agentReceivedCopy', 'I received a copy of the results'],
                ['resultsDisplayed', 'Results were publicly displayed'],
                ['objectionRaised', 'I raised a formal objection'],
              ] as [keyof Draft, string][]
            ).map(([field, label]) => (
              <View key={field} style={s.observationRow}>
                <Text style={s.observationLabel}>{label}</Text>
                <Switch
                  value={!!draft[field as keyof Draft]}
                  onValueChange={(v) => updateDraft({ [field]: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}

            <View style={s.field}>
              <Text style={s.fieldLabel}>Comments / Observations</Text>
              <TextInput
                style={[s.input, s.textarea]}
                placeholder="Any irregularities, notes, or observations…"
                placeholderTextColor={colors.mutedForeground}
                value={draft.agentComments ?? ''}
                onChangeText={(v) => updateDraft({ agentComments: v })}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          </View>
        )}

        {/* ── STEP: Review ───────────────────────────────────────────────── */}
        {step === 'review' && draft && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>Review & Submit</Text>

            {/* Validation */}
            {validationFlags.length > 0 ? (
              <View style={s.validationBlock}>
                <View style={s.validationHeader}>
                  <Ionicons name="alert-circle" size={18} color={colors.warning} />
                  <Text style={s.validationTitle}>Validation Issues</Text>
                </View>
                {validationFlags.map((f) => (
                  <Text key={f} style={s.validationItem}>· {f}</Text>
                ))}
                <Text style={s.validationNote}>
                  You can still submit — the system will flag these for review.
                </Text>
              </View>
            ) : (
              <View style={s.validBlock}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={s.validText}>All checks passed</Text>
              </View>
            )}

            {/* Summary */}
            <View style={s.summaryCard}>
              <SummaryRow label="Station" value={draft.stationName ?? draft.stationId} />
              <SummaryRow label="Registered voters" value={(draft.registeredVoters ?? '—').toLocaleString()} />
              <SummaryRow label="Total votes cast" value={(draft.totalVotesCast ?? '—').toLocaleString()} />
              <SummaryRow label="Total valid votes" value={(draft.totalValidVotes ?? '—').toLocaleString()} />
              <SummaryRow label="Rejected ballots" value={(draft.rejectedBallots ?? '—').toLocaleString()} />
              <SummaryRow label="Candidate entries" value={String(Object.keys(draft.candidateVotes).length)} />
              <SummaryRow label="Photo captured" value={draft.photoUri ? '✓ Yes' : '✗ Missing'} />
              <SummaryRow label="Agent signed" value={draft.agentSigned ? '✓ Yes' : 'No'} />
            </View>

            {/* GPS info */}
            {draft.gpsLat && (
              <Text style={s.gpsLabel}>
                📍 GPS: {draft.gpsLat.toFixed(5)}, {draft.gpsLon?.toFixed(5)}
              </Text>
            )}

            {/* Submit */}
            <Pressable
              style={({ pressed }) => [s.submitBtn, pressed && { opacity: 0.88 }, submitting && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={[s.submitBtnText, { fontSize: 14 }]}>
                    {uploadingPhoto ? 'Uploading photo…' : 'Submitting…'}
                  </Text>
                </View>
              ) : (
                <>
                  <Ionicons name={isOnline ? 'cloud-upload-outline' : 'save-outline'} size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={s.submitBtnText}>
                    {isOnline ? 'Submit Now' : 'Save Offline'}
                  </Text>
                </>
              )}
            </Pressable>

            {!isOnline && (
              <Text style={s.offlineNote}>
                You're offline. Your submission will be saved locally and auto-uploaded when you reconnect.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Navigation bar */}
      {step !== 'station' && step !== 'review' && (
        <View style={[s.navBar, { paddingBottom: bottomPad + 12 }]}>
          <Pressable
            style={({ pressed }) => [s.navBack, pressed && { opacity: 0.7 }]}
            onPress={() => setStep(STEPS[stepIndex - 1])}
          >
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
            <Text style={s.navBackText}>Back</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.navNext, pressed && { opacity: 0.85 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setStep(STEPS[stepIndex + 1]);
            }}
          >
            <Text style={s.navNextText}>Next</Text>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      )}

      {step === 'station' && (
        <View style={{ height: bottomPad + 16 }} />
      )}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, flex: 1 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>
        {value}
      </Text>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: {
      fontSize: 15,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    progressRow: {
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    progressDot: { flex: 1, height: 4, borderRadius: 2 },
    content: { paddingHorizontal: 16 },
    stepContainer: { gap: 16 },
    stepTitle: {
      fontSize: 22,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginTop: 4,
    },
    stepSub: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    stationBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    stationBannerName: {
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    stationBannerCode: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    assignedStationCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      borderWidth: 2,
      borderColor: colors.primary,
    },
    assignedStationLabel: {
      fontSize: 11,
      fontFamily: 'Inter_600SemiBold',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    assignedStationName: {
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    assignedStationCode: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    dividerText: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    searchRow: { flexDirection: 'row', gap: 10 },
    searchBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      width: 50,
      height: 50,
      justifyContent: 'center',
      alignItems: 'center',
    },
    continueBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    continueBtnText: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
      color: colors.primary,
      flex: 1,
    },
    infoBox: {
      flexDirection: 'row',
      gap: 10,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    infoText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    warnBanner: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    warnText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    input: {
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 13,
      color: colors.foreground,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      borderWidth: 1,
      borderColor: colors.border,
    },
    field: { gap: 6 },
    fieldLabel: {
      fontSize: 12,
      fontFamily: 'Inter_600SemiBold',
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    numberField: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    numberInput: {
      width: 120,
      textAlign: 'right',
      fontFamily: 'Inter_600SemiBold',
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    candidateName: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
    },
    candidateParty: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    votesInput: { width: 100, textAlign: 'right', fontFamily: 'Inter_700Bold' },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 12,
      borderTopWidth: 2,
      borderTopColor: colors.border,
    },
    totalLabel: {
      fontSize: 13,
      fontFamily: 'Inter_700Bold',
      color: colors.mutedForeground,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    totalValue: {
      fontSize: 20,
      fontFamily: 'Inter_700Bold',
    },
    emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
    emptyText: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
    },
    photoContainer: { gap: 12 },
    photo: {
      width: '100%',
      height: 220,
      borderRadius: colors.radius,
      backgroundColor: colors.muted,
    },
    photoSizeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-end',
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    photoSizeText: {
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      color: colors.mutedForeground,
    },
    retakeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    retakeBtnText: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.primary,
    },
    cameraCard: {
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 40,
      borderWidth: 2,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    cameraIconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.muted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cameraTitle: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
    },
    cameraSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 18,
    },
    observationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    observationLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.foreground,
      paddingRight: 12,
    },
    textarea: {
      height: 100,
      paddingTop: 12,
      textAlignVertical: 'top',
    },
    validationBlock: {
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    validationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    validationTitle: {
      fontSize: 14,
      fontFamily: 'Inter_700Bold',
      color: colors.warning,
    },
    validationItem: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    validationNote: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      fontStyle: 'italic',
      marginTop: 4,
    },
    validBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.success,
    },
    validText: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.success,
    },
    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    gpsLabel: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
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
      fontSize: 17,
      fontFamily: 'Inter_700Bold',
    },
    offlineNote: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 18,
    },
    navBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    navBack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    navBackText: {
      fontSize: 15,
      fontFamily: 'Inter_500Medium',
      color: colors.foreground,
    },
    navNext: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: colors.radius,
    },
    navNextText: {
      fontSize: 15,
      fontFamily: 'Inter_600SemiBold',
      color: '#FFFFFF',
    },
    successScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 16,
    },
    successIconCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: '#00BA7C',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    successTitle: {
      fontSize: 32,
      fontFamily: 'Inter_700Bold',
      color: '#00BA7C',
    },
    successSub: {
      fontSize: 16,
      fontFamily: 'Inter_500Medium',
      color: '#8899A6',
      textAlign: 'center',
    },
    successNote: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: '#8899A6',
      textAlign: 'center',
      lineHeight: 20,
    },
    doneBtn: {
      marginTop: 16,
      backgroundColor: '#1D9BF0',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 32,
    },
    doneBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
  });
