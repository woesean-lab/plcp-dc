import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// A bot-only transport. It has no dependency on the Members Onliner runtime.
export function createBotGateway(account, { publish, Socket = WebSocket, agent = value => value.startsWith("socks")
  ? new SocksProxyAgent(value) : new HttpsProxyAgent(value), timers = globalThis, random = Math.random } = {}) {
  let socket, heartbeat, deadline, retry, stopped = false, acknowledged = true;
  let sequence = null, sessionId = null, resumeUrl = null, attempts = 0;
  let state = { connectionState: "connecting", lastError: null };
  const update = (connectionState, lastError = null) => {
    state = { connectionState, lastError };
    publish?.(state);
  };
  const clearConnectionTimers = () => {
    timers.clearTimeout(heartbeat); timers.clearTimeout(deadline);
    heartbeat = deadline = null;
  };
  function open() {
    if (stopped) return;
    update(attempts ? "reconnecting" : "connecting");
    let url = "wss://gateway.discord.gg/?v=10&encoding=json";
    if (sessionId && Number.isInteger(sequence) && resumeUrl) url = resumeUrl;
    const active = new Socket(url, { agent: agent(account.proxyUrl), handshakeTimeout: 20000 });
    let retryDelay = 0;
    socket = active;
    acknowledged = true;
    deadline = timers.setTimeout(() => {
      if (socket !== active || stopped) return;
      update("reconnecting", "Bot Gateway did not become ready in time.");
      active.terminate();
    }, 30000);
    deadline.unref?.();
    const send = (op, d) => { if (!stopped && socket === active && active.readyState === Socket.OPEN) active.send(JSON.stringify({ op, d })); };
    const beat = () => {
      if (stopped || socket !== active) return;
      if (!acknowledged) { active.terminate(); return; }
      acknowledged = false;
      send(1, sequence);
    };
    active.on("message", raw => {
      if (stopped || socket !== active) return;
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }
      if (Number.isInteger(frame.s)) sequence = frame.s;
      if (frame.op === 10) {
        timers.clearTimeout(heartbeat);
        const interval = Math.max(1000, Number(frame.d?.heartbeat_interval) || 45000);
        const scheduleBeat = delay => {
          heartbeat = timers.setTimeout(() => { beat(); if (!stopped && socket === active) scheduleBeat(interval); }, delay);
          heartbeat.unref?.();
        };
        scheduleBeat(Math.floor(random() * interval));
        if (sessionId && Number.isInteger(sequence) && resumeUrl) send(6, { token: account.botToken, session_id: sessionId, seq: sequence });
        else send(2, {
          token: account.botToken, intents: 0,
          properties: { os: process.platform, browser: "Pulcip Bots", device: "Pulcip Bots" },
          presence: { since: null, activities: [], status: "online", afk: false }
        });
      } else if (frame.op === 11) acknowledged = true;
      else if (frame.op === 1) { acknowledged = false; send(1, sequence); }
      else if (frame.op === 7) active.close(4000, "Bot Gateway reconnect");
      else if (frame.op === 9) {
        if (frame.d !== true) { sessionId = resumeUrl = null; sequence = null; }
        active.close(4000, "Bot Gateway session invalidated");
      } else if (frame.op === 0 && frame.t === "READY") {
        if (String(frame.d?.user?.id) !== account.clientId || frame.d?.user?.bot === false) {
          stopped = true; clearConnectionTimers();
          update("error", "The saved bot token belongs to another identity.");
          active.close(1000, "Bot identity mismatch");
          return;
        }
        sessionId = frame.d?.session_id || null;
        try {
          const parsed = new URL(frame.d?.resume_gateway_url);
          if (parsed.protocol !== "wss:" || !(parsed.hostname === "gateway.discord.gg" || parsed.hostname.endsWith(".discord.gg"))) throw Error();
          parsed.search = "?v=10&encoding=json"; resumeUrl = parsed.toString();
        } catch { resumeUrl = null; }
        attempts = 0; timers.clearTimeout(deadline); deadline = null;
        update("connected");
      } else if (frame.op === 0 && frame.t === "RESUMED") {
        attempts = 0; timers.clearTimeout(deadline); deadline = null; update("connected");
      }
    });
    active.on("error", () => {
      if (!stopped && socket === active) update("reconnecting", "Bot proxy or Gateway connection failed.");
    });
    active.on("unexpected-response", (_request, response) => {
      if (stopped || socket !== active) return;
      response.resume?.();
      if (response.statusCode === 407) {
        stopped = true; clearConnectionTimers(); update("error", "Bot proxy authentication failed (407). Check the Bot proxies credentials.");
      } else if (response.statusCode === 429) {
        retryDelay = Math.max(300000, (Number(response.headers?.["retry-after"]) || 0) * 1000);
      }
      active.terminate();
    });
    active.on("close", code => {
      if (stopped || socket !== active) return;
      clearConnectionTimers(); socket = null;
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
        stopped = true;
        update("error", `Discord rejected the bot Gateway session (${code}). Disconnect and check the bot settings before retrying.`);
        return;
      }
      if ([1000, 1001, 4003, 4007, 4009].includes(code)) { sessionId = resumeUrl = null; sequence = null; }
      if (++attempts > 12) { stopped = true; update("error", "Bot reconnect limit reached. Disconnect and connect again to retry."); return; }
      update("reconnecting", `Bot Gateway disconnected (${code}); retrying.`);
      retry = timers.setTimeout(() => { try { open(); } catch { stopped = true; update("error", "The bot proxy connection could not be restarted."); } },
        Math.max(retryDelay, code === 4008 ? 300000 : Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)) + Math.floor(random() * 1000)));
      retry.unref?.();
    });
  }
  return {
    start() { try { open(); } catch { stopped = true; update("error", "The bot proxy connection could not be started."); } },
    snapshot: () => ({ ...state }),
    stop() {
      stopped = true; clearConnectionTimers(); timers.clearTimeout(retry);
      const active = socket; socket = null;
      if (active) { try { active.terminate(); } catch {} }
      state = { connectionState: "disconnected", lastError: null };
    }
  };
}
