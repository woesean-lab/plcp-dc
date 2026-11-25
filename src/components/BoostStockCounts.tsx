import { Skeleton } from "./ui/skeleton";

export function BoostStockCounts({ loading = false, tokens, boosts, requiredTokens }: {
  loading?: boolean;
  tokens?: number;
  boosts?: number;
  requiredTokens: number;
}) {
  return <>
    <div className="service-option-description" role={loading ? "status" : undefined} aria-label={loading ? "Loading boost stock" : undefined}>
      {loading ? <Skeleton className="h-[1.45em] w-44 max-w-full" aria-hidden="true" /> : tokens === undefined ? "Stock unavailable" : <>{tokens} tokens available · {requiredTokens} needed</>}
    </div>
    <div className="service-option-code service-option-code-badge" aria-hidden={loading || undefined}>
      {loading ? <Skeleton className="h-[1.3em] w-[54px]" /> : boosts === undefined ? "Unavailable" : `${boosts} BOOSTS`}
    </div>
  </>;
}
