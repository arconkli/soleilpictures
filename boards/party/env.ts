// What the party Worker is given: wrangler.jsonc binds the three Durable Object
// classes and SUPABASE_URL; the rest are secrets (`wrangler secret put`), the
// same five PartyKit held.
export interface Env {
  Main: DurableObjectNamespace;
  Workspace: DurableObjectNamespace;
  Universe: DurableObjectNamespace;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export const DEFAULT_SUPABASE_URL = "https://ehlhlmbpwwalmeisvmdp.supabase.co";
