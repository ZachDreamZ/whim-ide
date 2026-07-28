/**
 * OmniRoute Integration Configuration
 * 
 * Centralized configuration for the OmniRoute model routing gateway.
 * OmniRoute provides intelligent model selection based on task type and cost optimization.
 */

export const OMNIROUTE_DEFAULT_BASE = "http://127.0.0.1:20128/v1";
export const OMNIROUTE_PROVIDER_ID = "omniroute";

/**
 * OmniRoute model routes for different task types
 * - auto/cheap: For read-only work (research, planning, analysis)
 * - auto/coding: For implementation work (coding, debugging, testing)
 */
export const OMNIROUTE_ROUTES = [
  "auto/cheap",
  "auto/coding",
] as const;

export type OmniRouteModel = (typeof OMNIROUTE_ROUTES)[number];

/**
 * Determine if a provider is OmniRoute
 */
export function isOmniRouteProvider(provider: string): boolean {
  return provider.toLowerCase() === OMNIROUTE_PROVIDER_ID;
}

/**
 * Get the appropriate OmniRoute model based on agent role
 */
export function getOmniRouteModelForRole(agent: string): OmniRouteModel | null {
  if (!isOmniRouteProvider(agent)) return null;
  
  // Read-only roles use cheap route
  const readOnlyRoles = new Set([
    "planner", "researcher", "reviewer", "tester", "securityreviewer",
    "gamedesigner", "playtester"
  ]);
  
  if (readOnlyRoles.has(agent)) {
    return OMNIROUTE_ROUTES[0]; // auto/cheap
  }
  
  // All other roles use coding route
  return OMNIROUTE_ROUTES[1]; // auto/coding
}

/**
 * Validate OmniRoute base URL
 * Must be localhost/127.0.0.1 for security
 */
export function isValidOmniRouteBase(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    
    // Only allow localhost or 127.0.0.1
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Get default OmniRoute configuration
 */
export function getDefaultOmniRouteConfig() {
  return {
    provider: OMNIROUTE_PROVIDER_ID,
    baseUrl: OMNIROUTE_DEFAULT_BASE,
    model: null, // Let the system choose based on role
  };
}