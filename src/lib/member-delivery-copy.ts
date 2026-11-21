import type { CommunityMemberResult } from "../types";

export function publicMemberDeliveryCopy(item: CommunityMemberResult) {
  const state = item.state.toLowerCase();
  const delivery: Record<string, [string, string]> = {
    queued: ["Waiting", "Waiting to join the server."],
    joining: ["Joining", "Member is joining the server."],
    pending_join: ["Joining", "Member is joining the server."],
    replacing: ["Replacing", "A replacement member is being added."],
    joined: ["Joined", "Member joined the server."],
    already_member: ["Already a member", "Member was already in the server."],
    failed: ["Failed", "Member could not join the server."],
    blocked: ["Unable to join", "Member could not join the server."]
  };
  const [deliveryValue, defaultDetails] = delivery[state] ?? ["Unknown", "Member status is unavailable."];
  let deliveryDetails = defaultDetails;
  if (["failed", "blocked"].includes(state)) {
    if (/account.*verif|user.*(?:verified|verification)|50178/i.test(item.details)) deliveryDetails = "Account verification is required.";
    else if (/invalid invite|invite.*expir|unknown invite/i.test(item.details)) deliveryDetails = "The server invite is unavailable.";
    else if (/missing permissions|missing access/i.test(item.details)) deliveryDetails = "Server permissions prevent this member from joining.";
    else if (/rate limit|temporarily limited|invites.*limited/i.test(item.details)) deliveryDetails = "This join is temporarily limited.";
  }
  const access: Record<string, string> = { active: "Active", inactive: "Inactive", unknown: "Unknown", checking: "Checking" };
  const authorizationValue = item.authorizationStatus ? access[item.authorizationStatus.toLowerCase()] ?? "Unknown" : undefined;
  const leave: Record<string, [string, string]> = {
    waiting: ["Scheduled", "Member is waiting to leave the server."],
    queued: ["Scheduled", "Member is waiting to leave the server."],
    processing: ["Leaving", "Member is leaving the server."],
    left: ["Left", "Member left the server."],
    already_left: ["Already left", "Member is no longer in the server."],
    failed: ["Failed", "Member could not leave the server."]
  };
  const [leaveValue, leaveDetails] = leave[item.autoLeaveStatus?.toLowerCase() ?? ""] ?? ["Pending", "Member departure is pending."];
  const reaction: Record<string, string> = {
    queued: "Reaction is waiting.", pending: "Reaction is waiting.",
    processing: "Reaction is in progress.", running: "Reaction is in progress.",
    completed: "Reaction was added.", failed: "Reaction could not be added.", cancelled: "Reaction was cancelled."
  };
  return {
    deliveryValue, deliveryDetails, authorizationValue,
    authorizationDetails: authorizationValue ? "Account access: " + authorizationValue.toLowerCase() + "." : undefined,
    onlinerDetails: item.onlinerLive === true ? "Member is online." : item.onlinerLive === false ? "Member is offline." : undefined,
    leaveValue, leaveDetails,
    membershipDetails: item.membershipStatus === "removed" ? "Member is no longer in the server." : undefined,
    reactionDetails: reaction[item.reactionState?.toLowerCase() ?? ""] ?? "Reaction status is unavailable."
  };
}
