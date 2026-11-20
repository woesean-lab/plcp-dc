const resetTimeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false });

export function getReactionResetCountdown(resetsAt: string, now = Date.now()) {
  const deadline = new Date(resetsAt).getTime();
  if (!Number.isFinite(deadline)) return null;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return {
    seconds,
    label: [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":"),
    resetTime: resetTimeFormatter.format(new Date(deadline))
  };
}
