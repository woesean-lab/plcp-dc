const DISCORD_API_BASE = "https://discord.com/api/v10";

const inviteResolutionCache = new Map<string, string>();

function isGuildId(value: string) {
  return /^\d{17,20}$/.test(value);
}

function extractInviteCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (hostname === "discord.gg") {
      return segments[0] ?? null;
    }

    if (hostname === "discord.com" || hostname === "discordapp.com") {
      if (segments[0] === "invite") {
        return segments[1] ?? null;
      }
    }
  } catch {
    // Fall through to raw code handling.
  }

  if (/^[A-Za-z0-9_-]{3,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function resolveDiscordGuildId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Server ID or Discord invite link is required.");
  }

  if (isGuildId(trimmed)) {
    return trimmed;
  }

  const inviteCode = extractInviteCode(trimmed);
  if (!inviteCode) {
    throw new Error("Enter a Discord server ID or invite link.");
  }

  const cached = inviteResolutionCache.get(inviteCode);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${DISCORD_API_BASE}/invites/${encodeURIComponent(inviteCode)}?with_counts=false`);
  const payload = (await response.json().catch(() => ({}))) as {
    guild?: {
      id?: string;
    };
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message ?? "Discord invite could not be resolved.");
  }

  const guildId = payload.guild?.id;
  if (!guildId) {
    throw new Error("That invite does not resolve to a Discord server ID.");
  }

  inviteResolutionCache.set(inviteCode, guildId);
  return guildId;
}
