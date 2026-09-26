import nextEnv from '@next/env';
import { neon } from '@neondatabase/serverless';

nextEnv.loadEnvConfig(process.cwd(), true);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = neon(process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS openpdf_provider_credentials (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  label varchar(80) NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'gemini', 'compatible')),
  model varchar(120) NOT NULL,
  base_url varchar(500),
  key_hint varchar(8) NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
)`;
console.log('Account schema ready. No credentials printed.');
