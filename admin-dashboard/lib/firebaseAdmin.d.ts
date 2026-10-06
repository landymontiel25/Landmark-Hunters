export interface ServiceAccount { client_email: string; private_key: string; private_key_id?: string; project_id?: string; [k: string]: unknown }
export const KEY_ENV_NAMES: string[];
export function keyFromEnv(env?: Record<string, string | undefined>): string;
export function parseServiceAccount(raw?: string): ServiceAccount;
export function deadKeyProblem(account: ServiceAccount, fetchImpl?: typeof fetch): Promise<string | null>;
