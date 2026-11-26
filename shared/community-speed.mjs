export const COMMUNITY_BALANCED_DELAY_PATTERN = Object.freeze([30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100]);
const balanced2Small = Object.freeze([1, 4, 2, 6, 3, 5, 2, 4, 1, 5, 3, 6]);
const balanced2Medium = Object.freeze([30, 48, 36, 60, 42, 33, 54, 39, 45, 57, 51, 34]);

export function normalizeCommunitySpeedProfile(value) {
  const profile = String(value ?? "custom").trim().toLowerCase();
  return ["safe", "balanced", "balanced2", "fast"].includes(profile) ? profile : "custom";
}

export function getCommunitySpeedPattern(profile, added = 0) {
  if (profile === "balanced") return COMMUNITY_BALANCED_DELAY_PATTERN;
  if (profile !== "balanced2") return null;
  // added is the number already delivered. At 249, member 250 still uses
  // the first stage; at 250 the next member enters the second stage.
  const delivered = Math.max(0, Number(added) || 0);
  return delivered < 250 ? balanced2Small : delivered < 400 ? balanced2Medium : COMMUNITY_BALANCED_DELAY_PATTERN;
}

export function getCommunitySpeedRange(profile, added = 0) {
  const pattern = getCommunitySpeedPattern(profile, added);
  return pattern ? `${Math.min(...pattern)}–${Math.max(...pattern)}s` : "";
}

export function getCommunitySpeedPresetDelay(profile) {
  return profile === "safe" ? 700 : ["balanced", "balanced2"].includes(profile) ? 300 : profile === "fast" ? 60 : null;
}

export function getCommunitySpeedDelay(profile, configuredDelay, patternIndex, added = 0) {
  const pattern = getCommunitySpeedPattern(profile, added);
  return pattern && configuredDelay > 0 ? pattern[Math.max(0, patternIndex) % pattern.length] : configuredDelay;
}

export function getCommunitySpeedAverage(profile, configuredDelay, added = 0) {
  const pattern = getCommunitySpeedPattern(profile, added);
  return pattern && configuredDelay !== 0 ? pattern.reduce((total, delay) => total + delay, 0) / pattern.length : configuredDelay;
}

export function getCommunityDeliveryEstimateSeconds(profile, configuredDelay, amount, added) {
  if (!Number.isFinite(amount) || !Number.isFinite(added)) return undefined;
  const delivered = Math.max(0, added);
  const remaining = Math.max(0, amount - delivered);
  if (profile !== "balanced2" || configuredDelay === 0) {
    const average = getCommunitySpeedAverage(profile, configuredDelay, delivered);
    return average === undefined ? undefined : remaining * average;
  }
  // Include every remaining stage rather than multiplying the current stage's
  // delay by the whole remaining order (which understates later slow stages).
  return [[0, 250], [250, 400], [400, Infinity]].reduce((seconds, [start, end]) => {
    const members = Math.max(0, Math.min(amount, end) - Math.max(delivered, start));
    return seconds + members * getCommunitySpeedAverage(profile, configuredDelay, start);
  }, 0);
}

export function getCommunitySpeedLabel(profile) {
  return profile === "balanced2" ? "Balanced Fast" : profile === "balanced" ? "Balanced" : profile === "safe" ? "Safe" : profile === "fast" ? "Fast" : "Custom";
}

export function getCommunitySpeedDescription(profile, delay) {
  if (profile === "balanced2" && Number(delay) !== 0) return "Balanced Fast (members 1–250: 1–6s; 251–400: 30–60s; 401+: 30–300s)";
  const pattern = getCommunitySpeedPattern(profile);
  return pattern && delay !== 0
    ? `${getCommunitySpeedLabel(profile)} (variable ${Math.min(...pattern)}–${Math.max(...pattern)} second delay)`
    : `${delay} seconds (fully customizable)`;
}
