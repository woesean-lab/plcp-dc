import { BadgeCheck, Check, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { Button } from "./ui/button";
import type { HumanizerJob } from "../lib/humanizer";
import { isHumanizerJobActive } from "../lib/humanizer-job-state";

export function HumanizerRunHeader({ job, stopping = false, onStop }: {
  job: HumanizerJob; stopping?: boolean; onStop: () => void;
}) {
  const active = isHumanizerJobActive(job);
  const stoppingRun = stopping || job.status === "stopping";
  const stopped = job.status === "stopped";
  const failed = job.status === "failed";
  const attention = failed || job.failed > 0;
  const cancelled = job.cancelled ?? job.results.filter((result) => result.state === "cancelled").length;
  const progress = job.total ? Math.round(job.completed / job.total * 100) : 0;
  const title = stoppingRun ? "Stopping Humanizer" : active ? "Updating account profiles"
    : stopped ? "Latest run stopped" : failed ? "Latest run failed" : "Latest run completed";
  const description = stoppingRun ? "Accounts already running will finish. Queued accounts will not start."
    : active ? "Results update live as each account finishes." : "Review every applied change and account requiring attention.";

  return <header className="humanizer-run-head">
    <div className="onliner-section-heading">
      <span className="onliner-section-icon" aria-hidden="true">{active ? <LoaderCircle className="h-4 w-4 animate-spin" /> : stopped ? <Square className="h-4 w-4" /> : attention ? <CircleAlert className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}</span>
      <span><strong>{title}</strong><small>{description}</small></span>
    </div>
    <div className="humanizer-run-actions">
      <div className="humanizer-run-outcome" data-state={active ? "running" : stopped ? "stopped" : attention ? "attention" : "success"} role="status">
        <span className="humanizer-run-outcome-icon" aria-hidden="true">{active ? <LoaderCircle className="h-4 w-4 animate-spin" /> : stopped ? <Square className="h-4 w-4" /> : attention ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}</span>
        <span className="humanizer-run-outcome-copy">
          <strong>{stoppingRun ? "Stopping…" : active ? "Run in progress" : stopped ? "Run stopped" : failed ? "Run failed" : attention ? "Completed with attention" : "All updates complete"}</strong>
          <small>{active ? `${job.completed} of ${job.total} processed · ${progress}%`
            : stopped ? `${job.completed} of ${job.total} processed · ${cancelled} not started`
            : failed ? `${job.completed} of ${job.total} processed`
            : attention ? `${job.succeeded} successful · ${job.failed} need review`
            : `${job.succeeded} account${job.succeeded === 1 ? "" : "s"} updated successfully`}</small>
        </span>
      </div>
      {active && job.canStop !== false ? <Button type="button" variant="dangerGhost" size="sm" disabled={stoppingRun} onClick={onStop} aria-label="Stop Humanizer run" title="Accounts already running will finish. Queued accounts will not start.">
        {stoppingRun ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}{stoppingRun ? "Stopping…" : "Stop run"}
      </Button> : null}
    </div>
  </header>;
}
