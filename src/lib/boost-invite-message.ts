import toast from "react-hot-toast";

export const BOOST_BYPASS_INVITE_MESSAGE = "Create a new invite with Bypass Join Application enabled and send us that new invite link.";

export async function copyBoostBypassInviteMessage() {
  try {
    await navigator.clipboard.writeText(BOOST_BYPASS_INVITE_MESSAGE);
    toast.success("Message copied.");
  } catch {
    toast.error("Message could not be copied.");
  }
}
