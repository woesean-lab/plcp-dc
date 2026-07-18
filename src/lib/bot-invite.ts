type BotInviteSource = {
  details?: unknown;
  bot_invite?: unknown;
  botInvite?: unknown;
};

function normalizeDiscordInvite(value?: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    const allowedHost = url.hostname === "discord.com" || url.hostname === "www.discord.com" || url.hostname === "discordapp.com";
    return url.protocol === "https:" && allowedHost && url.pathname.includes("/oauth2/authorize") ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractBotInvite(source: BotInviteSource | null) {
  if (!source) return null;
  const directInvite = normalizeDiscordInvite(source.bot_invite) ?? normalizeDiscordInvite(source.botInvite);
  if (directInvite) return directInvite;
  if (typeof source.details !== "string" || !source.details.trim()) return null;

  const document = new DOMParser().parseFromString(source.details, "text/html");
  return normalizeDiscordInvite(document.querySelector("a[href]")?.getAttribute("href"));
}

export function getPlainDetails(value?: unknown) {
  if (typeof value !== "string" || !value.trim()) return "No details.";
  const document = new DOMParser().parseFromString(value, "text/html");
  return (document.body.textContent ?? value).replace(/\s+/g, " ").trim();
}
