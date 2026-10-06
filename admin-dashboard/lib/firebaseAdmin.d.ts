export function parseServiceAccount(): Record<string, string>;
export const DASHBOARD_UID: string;
export const DASHBOARD_CLAIMS: { dashboardAdmin: boolean };
export function mintDashboardToken(): Promise<string>;
