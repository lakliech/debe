/**
 * New-user onboarding (mobile) — after sign-up, an account with no enrollment
 * applies here as a volunteer or polling agent. Stays pending until a campaign
 * coordinator approves on the web dashboard; polling agents then see their
 * station on the home screen.
 */
import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { SafeAreaView } from "react-native-safe-area-context";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const tenantSlug = process.env.EXPO_PUBLIC_TENANT_SLUG;

export default function OnboardingScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [role, setRole] = useState<"volunteer" | "polling-agent">("polling-agent");
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // On launch: approved applicants go straight home; pending ones see status.
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`https://${domain}/api/enrollments/me`, { headers: { Authorization: `Bearer ${token}` } });
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          if (rows.some((r: any) => r.status === "approved")) router.replace("/(home)" as never);
          else setSubmitted(true);
        }
      } catch { /* first launch offline — show the form */ }
    })();
  }, []);

  // Once submitted, poll application status — approval routes the user home.
  useEffect(() => {
    if (!submitted) return;
    const timer = setInterval(async () => {
      try {
        const token = await getToken();
        const res = await fetch(`https://${domain}/api/enrollments/me`, { headers: { Authorization: `Bearer ${token}` } });
        const rows = await res.json();
        if (Array.isArray(rows) && rows.some((r: any) => r.status === "approved")) {
          router.replace("/(home)" as never);
        }
      } catch { /* transient — next poll retries */ }
    }, 15_000);
    return () => clearInterval(timer);
  }, [submitted]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`https://${domain}/api/enrollments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          intendedRole: role,
          fullName: fullName.trim(),
          phoneNumber: phone.trim(),
          email: user?.primaryEmailAddress?.emailAddress ?? "",
          nationalId: role === "polling-agent" ? nationalId.trim() : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setSubmitted(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const valid = fullName.trim().length >= 2 && phone.trim().length >= 5 && (role !== "polling-agent" || nationalId.trim().length >= 5);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>Welcome aboard</Text>
        {submitted ? (
          <View style={{ gap: 12, marginTop: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "700" }}>Application submitted</Text>
            <Text style={{ color: "#555" }}>
              A campaign coordinator will review your {role === "polling-agent" ? "polling agent" : "volunteer"} application. You'll get access here once approved.
            </Text>
            <Pressable onPress={() => router.replace("/(home)" as never)} style={{ backgroundColor: "#111", padding: 14, borderRadius: 8, marginTop: 8 }}>
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Check my status</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={{ color: "#555" }}>How are you taking part?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["polling-agent", "volunteer"] as const).map((r) => (
                <Pressable key={r} onPress={() => setRole(r)} style={{ flex: 1, padding: 14, borderRadius: 8, borderWidth: 2, borderColor: role === r ? "#111" : "#ddd" }}>
                  <Text style={{ fontWeight: "700", textAlign: "center" }}>{r === "polling-agent" ? "Polling Agent" : "Volunteer"}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput placeholder="Full name" value={fullName} onChangeText={setFullName} style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12 }} />
            <TextInput placeholder="Phone (WhatsApp) e.g. +2547…" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12 }} />
            {role === "polling-agent" && (
              <TextInput placeholder="National ID number" value={nationalId} onChangeText={setNationalId} keyboardType="number-pad" style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12 }} />
            )}
            {error && <Text style={{ color: "#b91c1c" }}>{error}</Text>}
            <Pressable onPress={submit} disabled={!valid || busy} style={{ backgroundColor: valid ? "#111" : "#999", padding: 14, borderRadius: 8 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Submit application</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
