import { ArrowUpRight, ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORE_URL = "https://www.eldorado.gg/users/PulcipStore/shop/CustomItem?searchQuery=members";

export default function BrandPage() {
  return (
    <main className="brand-gate min-h-screen text-[var(--app-text)]">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <section className="brand-gate-card" aria-labelledby="brand-gate-title">
        <div className="brand-gate-mark" aria-hidden="true">
          <span className="brand-letter">P</span>
        </div>

        <p className="brand-gate-eyebrow">PulcipStore</p>
        <h1 id="brand-gate-title">Pulcip Members</h1>
        <p className="brand-gate-copy">Available exclusively through our official Eldorado store.</p>

        <div className="brand-gate-trust">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span>We only sell on Eldorado</span>
        </div>

        <Button asChild size="lg" className="brand-gate-action">
          <a href={STORE_URL} target="_blank" rel="noreferrer">
            <Store className="h-4 w-4" aria-hidden="true" />
            Visit official store
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
      </section>
    </main>
  );
}
