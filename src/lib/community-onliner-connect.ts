import { connectCommunityMemberToOnliner, type CommunityJoinRecord } from "./community";

export type CommunityOnlinerConnectMember = Pick<CommunityJoinRecord, "id" | "username" | "displayName" | "onlinerConnected" | "hasStoredAccountToken">;
export type CommunityOnlinerConnectFailure = { id: string; name: string; message: string };

// The single-member endpoint validates identity and assigns a proxy. Keep these
// requests sequential so each addition sees the configuration saved before it.
export async function connectCommunityMembersToOnliner(members: CommunityOnlinerConnectMember[], richPresenceEnabled: boolean, options: {
  onProgress?: (progress: { completed: number; total: number }) => void;
  connect?: typeof connectCommunityMemberToOnliner;
} = {}) {
  const unique = [...new Map(members.map((member) => [member.id, member])).values()];
  const connected: { id: string; accountId: string }[] = [];
  const skipped: string[] = [];
  const failed: CommunityOnlinerConnectFailure[] = [];
  const connect = options.connect ?? connectCommunityMemberToOnliner;
  options.onProgress?.({ completed: 0, total: unique.length });
  for (const [index, member] of unique.entries()) {
    try {
      if (member.onlinerConnected) { skipped.push(member.id); continue; }
      if (!member.hasStoredAccountToken) throw new Error("No saved account token. Add this account again before connecting it to Onliner.");
      const result = await connect(member.id, richPresenceEnabled);
      if (!result.connected) throw new Error("The account could not be added to Onliner.");
      connected.push({ id: member.id, accountId: result.accountId });
    } catch (error) {
      failed.push({ id: member.id, name: member.displayName || member.username, message: error instanceof Error ? error.message : "Account could not be connected." });
    } finally { options.onProgress?.({ completed: index + 1, total: unique.length }); }
  }
  return { connected, skipped, failed };
}
