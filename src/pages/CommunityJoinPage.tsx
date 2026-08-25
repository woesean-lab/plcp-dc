import { ArrowRight, Bot, CheckCircle2, LoaderCircle, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPublicCommunityStatus, type CommunityJoinSummary } from "../lib/community";

const resultMessages: Record<string, { title: string; copy: string; tone: "success" | "neutral" | "danger" }> = {
  authorized: { title: "Authorization saved", copy: "Your account is ready. The server owner can now add you to this server.", tone: "success" },
  joined: { title: "You're in", copy: "Your Discord account joined the server successfully.", tone: "success" },
  already_member: { title: "Already a member", copy: "This Discord account is already in the server.", tone: "neutral" },
  cancelled: { title: "Authorization cancelled", copy: "No changes were made to your Discord account.", tone: "neutral" },
  wait: { title: "Please wait", copy: "Wait a moment before opening Discord authorization again.", tone: "neutral" },
  unavailable: { title: "Join unavailable", copy: "This community invitation is not configured yet.", tone: "danger" },
  expired: { title: "Link expired", copy: "Start the Discord authorization again from this page.", tone: "danger" },
  invalid: { title: "Invalid request", copy: "Start the Discord authorization again from this page.", tone: "danger" },
  authorization_failed: { title: "Authorization failed", copy: "Discord did not grant the required join permission.", tone: "danger" },
  profile_failed: { title: "Profile unavailable", copy: "Your Discord profile could not be verified.", tone: "danger" },
  join_failed: { title: "Could not join", copy: "The server could not accept your account right now.", tone: "danger" },
  error: { title: "Something went wrong", copy: "Please try again in a moment.", tone: "danger" }
};

export default function CommunityJoinPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<CommunityJoinSummary | null>(null);
  const [error, setError] = useState("");
  const result = searchParams.get("result") ?? "";
  const message = resultMessages[result];

  useEffect(() => {
    let active = true;
    void getPublicCommunityStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setError("The community invitation could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [result]);

  const ready = Boolean(status?.configured);

  return (
    <main className="community-join-page">
      <section className="community-join-shell" aria-labelledby="community-join-title">
        <header className="community-join-header">
          <div className="community-guild-avatar" aria-hidden="true">
            {status?.bot?.avatarUrl ? <img src={status.bot.avatarUrl} alt="" /> : <Bot className="h-7 w-7" />}
          </div>
          <div className="min-w-0">
            <span className="community-kicker">Discord application</span>
            <h1 id="community-join-title">{status?.bot?.name ?? "Members Bot"}</h1>
          </div>
          <span className="community-secure-mark"><ShieldCheck className="h-4 w-4" /> Secure OAuth</span>
        </header>

        {message ? (
          <div className={`community-result is-${message.tone}`} role="status">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <span><strong>{message.title}</strong><small>{message.copy}</small></span>
          </div>
        ) : null}

        <div className="community-progress-block">
          <div className="community-progress-copy">
            <span><Users className="h-4 w-4" /> Connected users</span>
            <strong>{status ? status.authorized ?? 0 : "Loading..."}</strong>
          </div>
          <div className="community-progress-meta">
            {status?.guild?.memberCount != null ? <span>{status.guild.memberCount.toLocaleString()} current members</span> : null}
          </div>
        </div>

        <div className="community-consent-note">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          <span><strong>You stay in control</strong><small>Discord will ask for permission to add you to this server later. The renewable authorization is encrypted and you can revoke it from Discord Authorized Apps.</small></span>
        </div>

        {error ? <p className="community-error" role="alert">{error}</p> : null}
        {!status && !error ? <div className="community-loading"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading invitation</div> : null}

        <Button asChild size="lg" className="community-join-action" disabled={!ready}>
          {ready ? (
            <a href="/api/community/oauth/start">Authorize with Discord <ArrowRight className="h-4 w-4" /></a>
          ) : (
            <span>Authorization unavailable</span>
          )}
        </Button>
      </section>
    </main>
  );
}
