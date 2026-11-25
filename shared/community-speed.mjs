export const COMMUNITY_BALANCED_DELAY_PATTERN = Object.freeze([30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100]);
const balanced2Small = Object.freeze([1, 4, 2, 6, 3, 5, 2, 4, 1, 5, 3, 6]);
const balanced2Medium = Object.freeze([30, 48, 36, 60, 42, 33, 54, 39, 45, 57, 51, 34]);

export function normalizeCommunitySpeedProfile(value) {
  const profile = String(value ?? "custom").trim().toLowerCase();
  return ["safe", "balanced", "balanced2", "fast"].includes(profile) ? profile : "custom";
}

export function getCommunitySpeedPattern(profile, amount) {
  if (profile === "balanced") return COMMUNITY_BALANCED_DELAY_PATTERN;
  if (profile !== "balanced2") return null;
  // The purchased total determines the cadence for every round. Delivered or
  // replacement counts must never move an order into a faster size bracket.
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0 || total > 400) return COMMUNITY_BALANCED_DELAY_PATTERN;
  return total <= 250 ? balanced2Small : balanced2Medium;
}

export function getCommunitySpeedRange(profile, amount) {
  const pattern = getCommunitySpeedPattern(profile, amount);
  return pattern ? `${Math.min(...pattern)}–${Math.max(...pattern)}s` : "";
}

export function getCommunitySpeedPresetDelay(profile) {
  return profile === "safe" ? 700 : ["balanced", "balanced2"].includes(profile) ? 300 : profile === "fast" ? 60 : null;
}

export function getCommunitySpeedDelay(profile, configuredDelay, patternIndex, amount) {
  const pattern = getCommunitySpeedPattern(profile, amount);
  return pattern && configuredDelay > 0 ? pattern[Math.max(0, patternIndex) % pattern.length] : configuredDelay;
}

export function getCommunitySpeedAverage(profile, configuredDelay, amount) {
  const pattern = getCommunitySpeedPattern(profile, amount);
  return pattern && configuredDelay !== 0 ? pattern.reduce((total, delay) => total + delay, 0) / pattern.length : configuredDelay;
}

export function getCommunitySpeedLabel(profile) {
  return profile === "balanced2" ? "Balanced 2" : profile === "balanced" ? "Balanced" : profile === "safe" ? "Safe" : profile === "fast" ? "Fast" : "Custom";
}

export function getCommunitySpeedDescription(profile, delay, amount) {
  const pattern = getCommunitySpeedPattern(profile, amount);
  return pattern && delay !== 0
    ? `${getCommunitySpeedLabel(profile)} (variable ${Math.min(...pattern)}–${Math.max(...pattern)} second delay)`
    : `${delay} seconds (fully customizable)`;
}
