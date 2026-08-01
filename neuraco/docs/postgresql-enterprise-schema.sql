-- Cible entreprise future. Ce schéma n'est pas le moteur actif de NeuraCo.
-- PostgreSQL 16+, UUID généré par l'application, RLS à activer par organisation.

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role organization_role NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE organization_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  policy_revision bigint NOT NULL DEFAULT 1,
  allowed_models jsonb NOT NULL DEFAULT '[]',
  allowed_tools jsonb NOT NULL DEFAULT '[]',
  allowed_domains jsonb NOT NULL DEFAULT '[]',
  require_review boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shared_credit_wallets (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  balance numeric(20,6) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE shared_credit_ledger (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid,
  task_id uuid,
  kind varchar(40) NOT NULL,
  amount numeric(20,6) NOT NULL,
  idempotency_key varchar(160) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private_agents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  role varchar(240) NOT NULL,
  configuration jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private_plugins (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  version varchar(64) NOT NULL,
  manifest jsonb NOT NULL,
  artifact_sha256 char(64) NOT NULL,
  signer varchar(240),
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, name, version)
);

CREATE TABLE organization_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid,
  action varchar(120) NOT NULL,
  target_type varchar(80),
  target_id varchar(160),
  details jsonb NOT NULL DEFAULT '{}',
  previous_hash char(64) NOT NULL,
  entry_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX organization_members_user_idx ON organization_members(user_id);
CREATE INDEX shared_credit_ledger_org_time_idx ON shared_credit_ledger(organization_id, created_at DESC);
CREATE INDEX organization_audit_org_sequence_idx ON organization_audit(organization_id, sequence DESC);

