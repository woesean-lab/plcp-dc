export interface DiscordGuildResolution {
  guildId: string;
  guildName?: string;
  approximateMemberCount?: number;
  bypassesJoinApplication?: boolean;
}

const inviteResolutionCache = new Map<string, DiscordGuildResolution>();

function isGuildId(value: string) {
  return /^\d{17,20}$/.test(value);
}

export function extractDiscordInviteCode(value: string) {
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

export async function resolveDiscordGuildInfo(value: string): Promise<DiscordGuildResolution> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Server ID or Discord invite link is required.");
  }

  if (isGuildId(trimmed)) {
    return { guildId: trimmed };
  }

  const inviteCode = extractDiscordInviteCode(trimmed);
  if (!inviteCode) {
    throw new Error("Enter a Discord server ID or invite link.");
  }

  const cached = inviteResolutionCache.get(inviteCode);
  if (cached) {
    return cached;
  }

  let response: Response | null = null;
  try {
    const discordResponse = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (discordResponse.ok) {
      const discordPayload = (await discordResponse.json()) as {
        guild?: { id?: string; name?: string };
        approximate_member_count?: number;
        flags?: number;
      };
      const guildId = String(discordPayload.guild?.id ?? "");
      if (isGuildId(guildId)) {
        const resolution = {
          guildId,
          guildName: typeof discordPayload.guild?.name === "string" ? discordPayload.guild.name : undefined,
          approximateMemberCount: typeof discordPayload.approximate_member_count === "number" ? discordPayload.approximate_member_count : undefined,
          bypassesJoinApplication: Number.isInteger(discordPayload.flags)
            ? (Number(discordPayload.flags) & (1 << 3)) !== 0
            : undefined
        };
        inviteResolutionCache.set(inviteCode, resolution);
        return resolution;
      }
    }
  } catch {
    // Some browser/privacy configurations can block the direct Discord request.
    // Keep the authenticated backend resolver as a compatibility fallback.
  }

  try {
    response = await fetch("/api/discord/resolve", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: inviteCode })
    });
  } catch {
    throw new Error("The server could not be reached. Please try again.");
  }

  const payload = (await response.json().catch(() => ({}))) as {
    guildId?: string;
    guildName?: string;
    approximateMemberCount?: number;
    bypassesJoinApplication?: boolean;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message ?? "Discord invite could not be resolved.");
  }

  const guildId = payload.guildId;
  if (!guildId) {
    throw new Error("That invite does not resolve to a Discord server ID.");
  }

  const resolution = {
    guildId,
    guildName: typeof payload.guildName === "string" ? payload.guildName : undefined,
    approximateMemberCount: typeof payload.approximateMemberCount === "number" ? payload.approximateMemberCount : undefined,
    bypassesJoinApplication: typeof payload.bypassesJoinApplication === "boolean" ? payload.bypassesJoinApplication : undefined
  };
  inviteResolutionCache.set(inviteCode, resolution);
  return resolution;
}

export async function resolveDiscordGuildId(value: string) {
  const resolution = await resolveDiscordGuildInfo(value);
  return resolution.guildId;
}
