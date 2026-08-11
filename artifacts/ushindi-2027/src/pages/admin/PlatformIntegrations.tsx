/**
 * Platform Messaging Channels — /platform/integrations
 *
 * Configures the platform's OWN WhatsApp and SMS senders, used for
 * Debe → campaign-owner messages (independent of any campaign's connected
 * sender). Secrets are write-only: the API returns has* flags, never tokens.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Smartphone, RefreshCw, Send, PlugZap, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const QUERY_KEY = ["/api/platform/messaging-integrations"];

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface ChannelView {
  configured: boolean;
  enabled: boolean;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  hasAccessToken?: boolean;
  senderId?: string | null;
  webhookUrl?: string | null;
  hasWebhookToken?: boolean;
  updatedAt?: string;
}

interface IntegrationsState {
  whatsapp: ChannelView;
  sms: ChannelView;
}

function StatusBadge({ channel }: { channel: ChannelView }) {
  if (!channel.configured) return <Badge variant="outline">Not connected</Badge>;
  if (!channel.enabled) return <Badge variant="secondary">Disabled</Badge>;
  return <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/30">Connected</Badge>;
}

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Shared test-send row for both channels. */
function TestSend({ channel, configured }: { channel: "whatsapp" | "sms"; configured: boolean }) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const send = useMutation({
    mutationFn: () => apiFetch(`/api/platform/messaging-integrations/${channel}/test`, { method: "POST", body: JSON.stringify({ to }) }),
    onSuccess: () => toast({ title: "Test message sent", description: `Delivered to ${to} via the platform ${channel} channel.` }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="flex items-end gap-2 pt-3 border-t border-border/60 mt-4">
      <div className="flex-1">
        <Field
          label="Send a test"
          placeholder="2547XXXXXXXX"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={!configured || to.trim().length < 8 || send.isPending}
        onClick={() => send.mutate()}
      >
        <Send className="h-4 w-4" />
        {send.isPending ? "Sending…" : "Send test"}
      </Button>
    </div>
  );
}

function WhatsappCard({ view }: { view: ChannelView }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setPhoneNumberId(view.phoneNumberId ?? "");
    setBusinessAccountId(view.businessAccountId ?? "");
    setEnabled(view.configured ? view.enabled : true);
    setAccessToken("");
  }, [view]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/platform/messaging-integrations/whatsapp", {
        method: "PUT",
        body: JSON.stringify({
          phoneNumberId: phoneNumberId.trim(),
          businessAccountId: businessAccountId.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
          enabled,
        }),
      }),
    onSuccess: () => {
      toast({ title: "WhatsApp channel saved", description: "The platform's WhatsApp sender is updated." });
      setAccessToken("");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/platform/messaging-integrations/whatsapp", { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "WhatsApp channel disconnected" });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast({ title: "Disconnect failed", description: e.message, variant: "destructive" }),
  });

  const tokenMissing = !view.hasAccessToken && !accessToken.trim();
  const canSave = /^\d{5,25}$/.test(phoneNumberId.trim()) && !tokenMissing && !save.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <CardTitle>WhatsApp Business</CardTitle>
          </div>
          <StatusBadge channel={view} />
        </div>
        <CardDescription>
          The platform's own Meta WhatsApp Cloud sender. Falls back to the server
          environment's WHATSAPP_* configuration for any field left unconnected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number ID" placeholder="e.g. 1045…" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} hint="Numeric ID from Meta Business Suite." />
          <Field label="Business account ID (optional)" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
        </div>
        <Field
          label="Access token"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={view.hasAccessToken ? "Leave blank to keep the current token" : "Permanent access token"}
          hint="Stored encrypted and never shown again."
        />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="wa-enabled" />
            <Label htmlFor="wa-enabled">Channel enabled</Label>
          </div>
          <div className="flex gap-2">
            {view.configured && (
              <Button variant="outline" size="sm" className="gap-2 text-destructive" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            )}
            <Button size="sm" className="gap-2" disabled={!canSave} onClick={() => save.mutate()}>
              <PlugZap className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <TestSend channel="whatsapp" configured={view.configured && view.enabled} />
      </CardContent>
    </Card>
  );
}

function SmsCard({ view }: { view: ChannelView }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [senderId, setSenderId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setSenderId(view.senderId ?? "");
    setWebhookUrl(view.webhookUrl ?? "");
    setEnabled(view.configured ? view.enabled : true);
    setWebhookToken("");
  }, [view]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/platform/messaging-integrations/sms", {
        method: "PUT",
        body: JSON.stringify({
          senderId: senderId.trim() || undefined,
          webhookUrl: webhookUrl.trim() || undefined,
          webhookToken: webhookToken.trim() || undefined,
          enabled,
        }),
      }),
    onSuccess: () => {
      toast({ title: "SMS channel saved", description: "The platform's SMS relay is updated." });
      setWebhookToken("");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/platform/messaging-integrations/sms", { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "SMS channel disconnected" });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast({ title: "Disconnect failed", description: e.message, variant: "destructive" }),
  });

  const urlMissing = !view.webhookUrl && !webhookUrl.trim();
  const tokenMissing = !view.hasWebhookToken && !webhookToken.trim();
  const canSave = !urlMissing && !tokenMissing && !save.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <CardTitle>SMS</CardTitle>
          </div>
          <StatusBadge channel={view} />
        </div>
        <CardDescription>
          Outbound SMS through the platform's webhook relay (Africa's Talking /
          Twilio behind a thin relay endpoint). Falls back to the server
          environment's COMMS_SMS_WEBHOOK_URL when unconnected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender ID (optional)" placeholder="e.g. DEBE" value={senderId} onChange={(e) => setSenderId(e.target.value)} hint="Alphanumeric sender name shown to recipients." />
          <Field
            label="Webhook URL"
            placeholder="https://relay.example.com/sms"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            hint={view.webhookUrl ? "Saved — enter a new URL only to replace it." : "The relay receives POST { to, channel, body, senderId, deliveryId }."}
          />
        </div>
        <Field
          label="Webhook bearer token"
          type="password"
          value={webhookToken}
          onChange={(e) => setWebhookToken(e.target.value)}
          placeholder={view.hasWebhookToken ? "Leave blank to keep the current token" : "Shared secret for the relay"}
          hint={view.hasWebhookToken ? "Stored encrypted and never shown again." : "Required — authenticates the platform to the relay. Stored encrypted and never shown again."}
        />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="sms-enabled" />
            <Label htmlFor="sms-enabled">Channel enabled</Label>
          </div>
          <div className="flex gap-2">
            {view.configured && (
              <Button variant="outline" size="sm" className="gap-2 text-destructive" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            )}
            <Button size="sm" className="gap-2" disabled={!canSave} onClick={() => save.mutate()}>
              <PlugZap className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <TestSend channel="sms" configured={view.configured && view.enabled} />
      </CardContent>
    </Card>
  );
}

export default function PlatformIntegrations() {
  const { data, isLoading, refetch } = useQuery<IntegrationsState>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch("/api/platform/messaging-integrations"),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 border border-primary/20 rounded-sm">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Messaging Channels</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              The platform's own WhatsApp and SMS senders — for messages from Debe to campaign owners.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="gap-2 shrink-0">
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <WhatsappCard view={data?.whatsapp ?? { configured: false, enabled: false }} />
      <SmsCard view={data?.sms ?? { configured: false, enabled: false }} />
    </div>
  );
}
