export type CommunityInviteRestriction = {
  source: "join_response" | "guild_settings" | "legacy_result";
  detectedAt: string;
  discordCode?: number;
  httpStatus?: number;
  invitesDisabled?: boolean;
  invitesDisabledUntil?: string;
  added?: number;
  configuredDelay?: number;
  speedProfile?: string;
};
export function captureCommunityInviteRestriction(input?: {
  result?: { payload?: { code?: unknown }; response?: { status?: unknown } };
  guild?: { features?: unknown; incidents_data?: { invites_disabled_until?: unknown } };
  legacy?: boolean;
  added?: number;
  delay?: number;
  speedProfile?: string;
}, now?: number): CommunityInviteRestriction;
export function communityInviteRestrictionSummary(restriction?: CommunityInviteRestriction): string;
