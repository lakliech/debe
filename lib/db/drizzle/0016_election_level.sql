-- Add electionLevel column to branding table
-- Supports: Presidential, Gubernatorial, Senatorial, Women Rep, MP, MCA
ALTER TABLE "branding" ADD COLUMN IF NOT EXISTS "election_level" text NOT NULL DEFAULT 'Presidential';
