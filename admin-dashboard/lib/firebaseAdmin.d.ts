export interface ServiceAccount { client_email: string; private_key: string; private_key_id?: string; project_id?: string; [k: string]: unknown }
export function parseServiceAccount(raw?: string): ServiceAccount;
export const DASHBOARD_UID: string;
export const DASHBOARD_CLAIMS: { dashboardAdmin: boolean };
export function mintDashboardToken(account?: ServiceAccount): Promise<string>;
