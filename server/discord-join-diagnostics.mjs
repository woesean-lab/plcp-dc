// Diagnostics never refresh credentials or attempt another join.
export function oauthJoinDiagnosis(result, userId, applicationId) {
  if (!result?.response?.ok) {
    return result?.response?.status === 401
      ? "OAuth check: access token rejected (HTTP 401); re-authorization is required."
      : `OAuth check inconclusive (HTTP ${Number(result?.response?.status) || "unknown"}).`;
  }
  const problems = [];
  if (String(result.payload?.user?.id ?? "") !== String(userId)) problems.push("user ID mismatch");
  const actualApp = String(result.payload?.application?.id ?? "");
  if (!actualApp) problems.push("application ID missing");
  else if (actualApp !== String(applicationId)) problems.push("application ID mismatch");
  if (!Array.isArray(result.payload?.scopes) || !result.payload.scopes.includes("guilds.join")) problems.push("guilds.join scope missing");
  return problems.length
    ? `OAuth check: ${problems.join("; ")}.`
    : "OAuth check passed: user, application and guilds.join match. The join rejection remains unexplained by OAuth checks.";
}

export async function diagnoseGuildJoinFailure(result, { request, userId, applicationId, accessToken, botToken }) {
  if (![400, 401, 403].includes(result.response.status)) return result;
  let diagnosis;
  try {
    diagnosis = oauthJoinDiagnosis(await request("oauth2/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    }), userId, applicationId);
  } catch {
    diagnosis = "OAuth check inconclusive: Discord could not be reached.";
  }
  return { ...result, joinDiagnosis: diagnosis, diagnosticSecrets: [accessToken, botToken] };
}

export function discordFailureDetails(label, result) {
  const clean = value => {
    let text = String(value ?? "");
    for (const secret of result?.diagnosticSecrets || []) {
      if (secret) text = text.split(secret).join("[redacted]");
    }
    return text.replace(/(?:Bearer|Bot)\s+[^\s,;"<>]+/gi, "[redacted authorization]")
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  };
  const status = Number(result?.response?.status ?? 0);
  const code = Number(result?.payload?.code ?? 0);
  const captcha = Boolean(result?.payload?.captcha_sitekey)
    || (Array.isArray(result?.payload?.captcha_key) && result.payload.captcha_key.length > 0);
  const message = captcha ? "Discord requires CAPTCHA verification for this account or network."
    : clean(result?.payload?.message) || "Discord rejected the request.";
  const fields = [];
  const visit = (node, path = "", depth = 0) => {
    if (!node || typeof node !== "object" || depth > 6 || fields.length >= 5) return;
    if (Array.isArray(node._errors)) {
      for (const error of node._errors.slice(0, 5 - fields.length)) {
        // Error codes and paths identify the failed field; never echo field values.
        fields.push(`${clean(path) || "request"}: ${clean(error?.code) || "invalid field"}`);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "_errors") visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(result?.payload?.errors);
  const context = [];
  if (fields.length) context.push(`Fields: ${fields.join("; ")}`);
  if (result?.nonJsonResponse) context.push("Discord returned a non-JSON response; no structured error code was available.");
  const ray = clean(result?.response?.headers?.get?.("cf-ray"));
  if (/^[a-zA-Z0-9-]{1,80}$/.test(ray)) context.push(`Request reference: ${ray}`);
  if (result?.joinDiagnosis) context.push(result.joinDiagnosis);
  return `${label} failed (HTTP ${status || "unknown"}${code ? `, Discord code ${code}` : ""}): ${message}${context.length ? ` ${context.join(" ")}` : ""}`;
}
