/**
 * Transactional email templates.
 *
 * Each template is a pure function of its typed data → { subject, text, html }.
 * Keeping them typed means adding a field to a template forces every call site
 * to supply it.
 *
 * HTML is intentionally simple and inline-styled — transactional mail clients
 * strip <style> blocks and external CSS.
 */

const BRAND = "Campaign Platform";

function platformUrl(): string {
  return process.env.PLATFORM_URL ?? "https://example.com";
}

// ── Shared HTML chrome ───────────────────────────────────────────────────────

function wrap(bodyHtml: string, preheader?: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e3e5e8;overflow:hidden;">
          <tr><td style="padding:24px 32px;border-bottom:1px solid #e3e5e8;">
            <span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f1115;">${BRAND}</span>
          </td></tr>
          <tr><td style="padding:32px;color:#2b2f36;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px;background:#fafbfc;border-top:1px solid #e3e5e8;color:#6b7280;font-size:12px;line-height:1.5;">
            You are receiving this because you manage a campaign on ${BRAND}.<br/>
            <a href="${platformUrl()}" style="color:#6b7280;">${platformUrl().replace(/^https?:\/\//, "")}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:#1D9BF0;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
  </p>`;
}

// ── Template data contracts ──────────────────────────────────────────────────

export interface TemplateData {
  campaign_welcome: {
    campaignName: string;
    adminName?: string;
    dashboardUrl: string;
    trialDays: number;
  };
  staff_invitation: {
    campaignName: string;
    inviterName?: string;
    acceptUrl: string;
    roleName?: string;
  };
  trial_expiring: {
    campaignName: string;
    daysLeft: number;
    upgradeUrl: string;
  };
  trial_ended: {
    campaignName: string;
    upgradeUrl: string;
  };
  payment_receipt: {
    campaignName: string;
    planLabel: string;
    amountKes: number;
    invoiceUrl?: string;
    periodEnd?: string;
  };
  payment_failed: {
    campaignName: string;
    billingPortalUrl: string;
    graceDays: number;
  };
  campaign_suspended: {
    campaignName: string;
    reason?: string;
    supportEmail: string;
  };
  campaign_reactivated: {
    campaignName: string;
    dashboardUrl: string;
  };
  deletion_scheduled: {
    campaignName: string;
    deletionDate: string;
    cancelContact: string;
  };
  deletion_cancelled: {
    campaignName: string;
    dashboardUrl: string;
  };
  security_digest: {
    subjectLine: string;
    summary: string;
    details: string[];
  };
  aspirant_declaration: {
    aspirantName: string;
    position: string;
    campaignName: string;
    reviewUrl: string;
  };
}

export type TemplateKey = keyof TemplateData;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// ── Renderers ────────────────────────────────────────────────────────────────

const renderers: {
  [K in TemplateKey]: (d: TemplateData[K]) => RenderedEmail;
} = {
  campaign_welcome: (d) => {
    const subject = `Welcome to ${BRAND} — ${d.campaignName} is live`;
    const greeting = d.adminName ? `Hi ${d.adminName},` : "Hi,";
    const text = `${greeting}

${d.campaignName} is now set up on ${BRAND}.

Your ${d.trialDays}-day Pro trial has started — every feature is unlocked, no card required.

Next steps:
  1. Upload your campaign logo
  2. Set your brand colours
  3. Invite your team
  4. Configure your polling stations
  5. Complete your campaign profile

Open your dashboard: ${d.dashboardUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 16px;"><strong>${escapeHtml(d.campaignName)}</strong> is now set up on ${BRAND}.</p>
       <p style="margin:0 0 8px;">Your <strong>${d.trialDays}-day Pro trial</strong> has started — every feature is unlocked, no card required.</p>
       <p style="margin:24px 0 8px;font-weight:600;">Next steps</p>
       <ol style="margin:0;padding-left:20px;color:#4b5563;">
         <li>Upload your campaign logo</li>
         <li>Set your brand colours</li>
         <li>Invite your team</li>
         <li>Configure your polling stations</li>
         <li>Complete your campaign profile</li>
       </ol>
       ${button(d.dashboardUrl, "Open your dashboard")}`,
      `${d.campaignName} is ready — your ${d.trialDays}-day Pro trial has started.`,
    );
    return { subject, text, html };
  },

  staff_invitation: (d) => {
    const subject = `You've been invited to join ${d.campaignName}`;
    const who = d.inviterName ? `${d.inviterName} has invited you` : "You have been invited";
    const role = d.roleName ? ` as ${d.roleName}` : "";
    const text = `${who} to join ${d.campaignName} on ${BRAND}${role}.

Accept your invitation: ${d.acceptUrl}

If you weren't expecting this, you can ignore this email.`;
    const html = wrap(
      `<p style="margin:0 0 16px;">${escapeHtml(who)} to join <strong>${escapeHtml(d.campaignName)}</strong> on ${BRAND}${escapeHtml(role)}.</p>
       ${button(d.acceptUrl, "Accept invitation")}
       <p style="margin:0;color:#6b7280;font-size:13px;">If you weren't expecting this, you can safely ignore this email.</p>`,
      `Join ${d.campaignName} on ${BRAND}.`,
    );
    return { subject, text, html };
  },

  trial_expiring: (d) => {
    const dayWord = d.daysLeft === 1 ? "day" : "days";
    const subject = `${d.daysLeft} ${dayWord} left on your ${d.campaignName} Pro trial`;
    const text = `Your Pro trial for ${d.campaignName} ends in ${d.daysLeft} ${dayWord}.

When it ends, ${d.campaignName} moves to the Free plan: agents are capped at 50, custom domains are disabled, and Excel exports are turned off. Your data stays intact.

Upgrade to keep full access: ${d.upgradeUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">Your Pro trial for <strong>${escapeHtml(d.campaignName)}</strong> ends in <strong>${d.daysLeft} ${dayWord}</strong>.</p>
       <p style="margin:0 0 16px;">When it ends, your campaign moves to the Free plan: agents capped at 50, custom domains disabled, Excel exports off. <strong>Your data stays intact.</strong></p>
       ${button(d.upgradeUrl, "Upgrade to Pro")}`,
      `${d.daysLeft} ${dayWord} left on your Pro trial.`,
    );
    return { subject, text, html };
  },

  trial_ended: (d) => {
    const subject = `Your ${d.campaignName} Pro trial has ended`;
    const text = `The Pro trial for ${d.campaignName} has ended and your campaign is now on the Free plan.

Your data is safe and nothing has been deleted. Upgrade any time to restore unlimited agents, custom domains, Excel exports, and advanced reporting.

Upgrade: ${d.upgradeUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">The Pro trial for <strong>${escapeHtml(d.campaignName)}</strong> has ended. Your campaign is now on the <strong>Free plan</strong>.</p>
       <p style="margin:0 0 16px;">Your data is safe and nothing has been deleted. Upgrade any time to restore unlimited agents, custom domains, Excel exports, and advanced reporting.</p>
       ${button(d.upgradeUrl, "Upgrade to Pro")}`,
      `Your Pro trial has ended — ${d.campaignName} is now on Free.`,
    );
    return { subject, text, html };
  },

  payment_receipt: (d) => {
    const amount = `KES ${d.amountKes.toLocaleString("en-KE")}`;
    const subject = `Payment received — ${d.campaignName} ${d.planLabel}`;
    const text = `Thank you. We've received your payment for ${d.campaignName}.

Plan:   ${d.planLabel}
Amount: ${amount}${d.periodEnd ? `\nNext billing date: ${d.periodEnd}` : ""}
${d.invoiceUrl ? `\nDownload your invoice: ${d.invoiceUrl}` : ""}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">Thank you. We've received your payment for <strong>${escapeHtml(d.campaignName)}</strong>.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:collapse;">
         <tr><td style="padding:8px 0;color:#6b7280;">Plan</td><td style="padding:8px 0;text-align:right;font-weight:600;">${escapeHtml(d.planLabel)}</td></tr>
         <tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #eef0f2;">Amount</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eef0f2;">${amount}</td></tr>
         ${d.periodEnd ? `<tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #eef0f2;">Next billing date</td><td style="padding:8px 0;text-align:right;border-top:1px solid #eef0f2;">${escapeHtml(d.periodEnd)}</td></tr>` : ""}
       </table>
       ${d.invoiceUrl ? button(d.invoiceUrl, "Download invoice") : ""}`,
      `Payment received for ${d.campaignName}.`,
    );
    return { subject, text, html };
  },

  payment_failed: (d) => {
    const subject = `Action needed: payment failed for ${d.campaignName}`;
    const text = `We couldn't process the latest payment for ${d.campaignName}.

Your campaign keeps full access for the next ${d.graceDays} days. After that it moves to the Free plan until payment succeeds.

Update your payment method: ${d.billingPortalUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">We couldn't process the latest payment for <strong>${escapeHtml(d.campaignName)}</strong>.</p>
       <p style="margin:0 0 16px;">Your campaign keeps full access for the next <strong>${d.graceDays} days</strong>. After that it moves to the Free plan until payment succeeds.</p>
       ${button(d.billingPortalUrl, "Update payment method")}`,
      `Payment failed — action needed for ${d.campaignName}.`,
    );
    return { subject, text, html };
  },

  campaign_suspended: (d) => {
    const subject = `${d.campaignName} has been suspended`;
    const text = `Access to ${d.campaignName} on ${BRAND} has been suspended.
${d.reason ? `\nReason: ${d.reason}\n` : ""}
Your data has not been deleted. To discuss reinstatement, contact ${d.supportEmail}.`;
    const html = wrap(
      `<p style="margin:0 0 16px;">Access to <strong>${escapeHtml(d.campaignName)}</strong> has been suspended.</p>
       ${d.reason ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fff7ed;border-left:3px solid #f59e0b;color:#7c2d12;"><strong>Reason:</strong> ${escapeHtml(d.reason)}</p>` : ""}
       <p style="margin:0 0 16px;">Your data has not been deleted. To discuss reinstatement, contact <a href="mailto:${escapeHtml(d.supportEmail)}" style="color:#1D9BF0;">${escapeHtml(d.supportEmail)}</a>.</p>`,
      `${d.campaignName} has been suspended.`,
    );
    return { subject, text, html };
  },

  campaign_reactivated: (d) => {
    const subject = `${d.campaignName} is active again`;
    const text = `Good news — ${d.campaignName} has been reactivated and your team has full access again.

Open your dashboard: ${d.dashboardUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">Good news — <strong>${escapeHtml(d.campaignName)}</strong> has been reactivated and your team has full access again.</p>
       ${button(d.dashboardUrl, "Open your dashboard")}`,
      `${d.campaignName} is active again.`,
    );
    return { subject, text, html };
  },

  deletion_scheduled: (d) => {
    const subject = `${d.campaignName} is scheduled for deletion on ${d.deletionDate}`;
    const text = `${d.campaignName} has been scheduled for permanent deletion on ${d.deletionDate}.

Access is suspended from now. On that date all campaign data — agents, submissions, finance records, volunteers — will be permanently erased and cannot be recovered.

To cancel this and restore your campaign, contact ${d.cancelContact} before ${d.deletionDate}.`;
    const html = wrap(
      `<p style="margin:0 0 16px;"><strong>${escapeHtml(d.campaignName)}</strong> has been scheduled for permanent deletion on <strong>${escapeHtml(d.deletionDate)}</strong>.</p>
       <p style="margin:0 0 16px;padding:12px 14px;background:#fef2f2;border-left:3px solid #dc2626;color:#7f1d1d;">Access is suspended from now. On that date all campaign data — agents, submissions, finance records, volunteers — will be permanently erased and cannot be recovered.</p>
       <p style="margin:0;">To cancel and restore your campaign, contact <a href="mailto:${escapeHtml(d.cancelContact)}" style="color:#1D9BF0;">${escapeHtml(d.cancelContact)}</a> before ${escapeHtml(d.deletionDate)}.</p>`,
      `${d.campaignName} will be deleted on ${d.deletionDate}.`,
    );
    return { subject, text, html };
  },

  deletion_cancelled: (d) => {
    const subject = `Deletion cancelled — ${d.campaignName} is safe`;
    const text = `The scheduled deletion of ${d.campaignName} has been cancelled and your campaign is active again.

Open your dashboard: ${d.dashboardUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">The scheduled deletion of <strong>${escapeHtml(d.campaignName)}</strong> has been cancelled. Your campaign is active again and no data was lost.</p>
       ${button(d.dashboardUrl, "Open your dashboard")}`,
      `Deletion cancelled for ${d.campaignName}.`,
    );
    return { subject, text, html };
  },

  security_digest: (d) => {
    const text = `${d.summary}\n\n${d.details.map((x) => `• ${x}`).join("\n")}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">${escapeHtml(d.summary)}</p>
       <ul style="margin:0;padding-left:20px;color:#4b5563;">
         ${d.details.map((x) => `<li style="margin-bottom:6px;">${escapeHtml(x)}</li>`).join("")}
       </ul>`,
      d.summary,
    );
    return { subject: d.subjectLine, text, html };
  },

  aspirant_declaration: (d) => {
    const subject = `New aspirant declaration — ${d.aspirantName} (${d.position})`;
    const text = `A new aspirant declaration has been submitted on ${d.campaignName} and is waiting for review.

Name:     ${d.aspirantName}
Position: ${d.position}

Review the application: ${d.reviewUrl}`;
    const html = wrap(
      `<p style="margin:0 0 16px;">A new aspirant declaration has been submitted on <strong>${escapeHtml(d.campaignName)}</strong> and is waiting for your review.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:collapse;">
         <tr>
           <td style="padding:8px 0;color:#6b7280;width:100px;">Name</td>
           <td style="padding:8px 0;font-weight:600;">${escapeHtml(d.aspirantName)}</td>
         </tr>
         <tr>
           <td style="padding:8px 0;color:#6b7280;border-top:1px solid #eef0f2;">Position</td>
           <td style="padding:8px 0;border-top:1px solid #eef0f2;">${escapeHtml(d.position)}</td>
         </tr>
       </table>
       ${button(d.reviewUrl, "Review declaration")}`,
      `New aspirant declaration from ${d.aspirantName} — pending review.`,
    );
    return { subject, text, html };
  },
};

export function renderTemplate<K extends TemplateKey>(
  key: K,
  data: TemplateData[K],
): RenderedEmail {
  const fn = renderers[key];
  if (!fn) throw new Error(`Unknown email template: ${key}`);
  return fn(data);
}
