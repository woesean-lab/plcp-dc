// Store evidence only: never include Discord response bodies, account IDs,
// credentials or diagnostic secrets in a restriction snapshot.
export function captureCommunityInviteRestriction({ result, guild, legacy = false, added, delay, speedProfile } = {}, now = Date.now()) {
  const code = Number(result?.payload?.code);
  const httpStatus = Number(result?.response?.status);
  const disabledUntil = Date.parse(String(guild?.incidents_data?.invites_disabled_until ?? ""));
  return {
    source: legacy ? "legacy_result" : result ? "join_response" : "guild_settings",
    detectedAt: new Date(now).toISOString(),
    ...(Number.isSafeInteger(code) && code > 0 ? { discordCode: code } : legacy ? { discordCode: 400002 } : {}),
    ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
    ...(guild ? { invitesDisabled: Array.isArray(guild.features) && guild.features.includes("INVITES_DISABLED") } : {}),
    ...(Number.isFinite(disabledUntil) && disabledUntil > now ? { invitesDisabledUntil: new Date(disabledUntil).toISOString() } : {}),
    ...(Number.isFinite(added) ? { added } : {}),
    ...(Number.isFinite(delay) ? { configuredDelay: delay } : {}),
    ...(["safe", "balanced", "balanced2", "fast", "custom"].includes(speedProfile) ? { speedProfile } : {})
  };
}

export function communityInviteRestrictionSummary(restriction) {
  if (!restriction) return "Server restriction detected. Open order details to review.";
  const parts = [restriction.source === "guild_settings"
    ? restriction.invitesDisabled ? "Server invites are disabled" : "Server invite pause is active"
    : restriction.source === "legacy_result" ? "Restriction recorded in earlier delivery results" : "Discord rejected new member access"];
  if (Number.isSafeInteger(restriction.discordCode) && restriction.discordCode > 0) parts.push(`Discord ${restriction.discordCode}`);
  if (Number.isInteger(restriction.httpStatus) && restriction.httpStatus >= 100 && restriction.httpStatus <= 599) parts.push(`HTTP ${restriction.httpStatus}`);
  return parts.join(" · ");
}
