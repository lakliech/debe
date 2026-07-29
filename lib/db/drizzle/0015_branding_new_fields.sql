-- Migration 0015: Add positionTitle, partyName, mpesaPaybill to branding table
ALTER TABLE "branding"
  ADD COLUMN IF NOT EXISTS "position_title" text NOT NULL DEFAULT 'Your Position',
  ADD COLUMN IF NOT EXISTS "party_name" text NOT NULL DEFAULT 'Your Party',
  ADD COLUMN IF NOT EXISTS "mpesa_paybill" text DEFAULT '';
