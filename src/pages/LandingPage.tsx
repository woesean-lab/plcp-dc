import { Activity, ArrowRight, ArrowUpRight, Check, Gauge, ShieldCheck, Sparkles, Store, Timer, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STORE_URL = "https://www.eldorado.gg/users/PulcipStore/shop/CustomItem?searchQuery=members";

const services = [
  { icon: Users, label: "OAuth Offline", title: "Offline members", copy: "Build a stronger member count with delivery configured around your server and order size." },
  { icon: Zap, label: "OAuth Online", title: "Online members", copy: "Add visible activity with online member packages designed for active Discord communities." },
  { icon: Gauge, label: "Flexible pacing", title: "Controlled delivery", copy: "Choose a delivery delay that fits your server, then follow every order from a live monitor." }
];

export default function LandingPage() {
  return (
    <main className="landing-shell min-h-screen text-[var(--app-text)]">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Pulcip Members home">
          <span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span>
          <span><span className="brand-eyebrow">PulcipStore</span><strong>Discord Members</strong></span>
        </a>
        <Badge variant="outline" className="landing-nav-badge"><Sparkles className="h-3 w-3" /> Available on Eldorado</Badge>
        <Button asChild size="sm"><a href={STORE_URL} target="_blank" rel="noreferrer">Visit store <ArrowUpRight className="h-4 w-4" /></a></Button>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <div className="landing-kicker"><span aria-hidden="true" /> Discord growth, delivered with control</div>
          <h1 id="landing-title">Make your Discord server feel <span>alive.</span></h1>
          <p className="landing-lead">Premium Discord member solutions for communities that want a stronger first impression, flexible delivery, and a clear view of every order.</p>
          <div className="landing-actions">
            <Button asChild size="lg" className="landing-primary-cta"><a href={STORE_URL} target="_blank" rel="noreferrer">Shop Discord members <ArrowUpRight className="h-4 w-4" /></a></Button>
            <Button asChild size="lg" variant="secondary"><a href="#services">Explore services <ArrowRight className="h-4 w-4" /></a></Button>
          </div>
          <div className="landing-trust-row" aria-label="Service highlights">
            <span><Check className="h-3.5 w-3.5" /> Flexible order sizes</span>
            <span><Check className="h-3.5 w-3.5" /> Adjustable delivery delay</span>
            <span><Check className="h-3.5 w-3.5" /> Live order monitor</span>
          </div>
        </div>

        <div className="landing-demo" aria-label="Example live delivery monitor">
          <div className="landing-demo-glow" aria-hidden="true" />
          <div className="landing-demo-top">
            <div><span className="landing-demo-eyebrow">Live delivery</span><strong>Community growth</strong></div>
            <Badge variant="success"><span className="landing-live-dot" /> Processing</Badge>
          </div>
          <div className="landing-demo-progress"><div className="landing-demo-count"><strong>493</strong><span>/ 500 members</span></div><span>98%</span></div>
          <div className="landing-progress-track"><span /></div>
          <div className="landing-demo-grid">
            <div><span><Users className="h-4 w-4" /></span><small>Delivered</small><strong>493</strong></div>
            <div><span><Timer className="h-4 w-4" /></span><small>Delay</small><strong>700s</strong></div>
            <div><span><Activity className="h-4 w-4" /></span><small>Remaining</small><strong>7</strong></div>
          </div>
          <div className="landing-demo-footer"><span><ShieldCheck className="h-4 w-4" /> Verified live feed</span><span>Auto-updating</span></div>
        </div>
      </section>

      <section id="services" className="landing-section" aria-labelledby="services-title">
        <div className="landing-section-heading">
          <div><p className="app-kicker">Members, your way</p><h2 id="services-title">Choose the right signal for your server.</h2></div>
          <p>From visible member count to active presence, select the delivery style that matches your community.</p>
        </div>
        <div className="landing-service-grid">
          {services.map(({ icon: Icon, label, title, copy }) => (
            <article key={title} className="landing-service-card">
              <span className="landing-service-icon"><Icon className="h-5 w-5" /></span><p className="app-kicker">{label}</p><h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-process" aria-labelledby="process-title">
        <div className="landing-section-heading"><div><p className="app-kicker">Simple by design</p><h2 id="process-title">From checkout to live tracking.</h2></div></div>
        <ol>
          <li><span>01</span><div><strong>Choose a package</strong><p>Open PulcipStore on Eldorado and pick the member option that fits.</p></div></li>
          <li><span>02</span><div><strong>Share your server</strong><p>Provide the requested Discord details and preferred delivery settings.</p></div></li>
          <li><span>03</span><div><strong>Watch it progress</strong><p>Follow delivered and remaining members from your private live monitor.</p></div></li>
        </ol>
      </section>

      <section className="landing-final-cta">
        <div><p className="app-kicker">Ready when you are</p><h2>Give your community a stronger first impression.</h2><p>Browse PulcipStore’s Discord member offers securely through Eldorado.</p></div>
        <Button asChild size="lg"><a href={STORE_URL} target="_blank" rel="noreferrer"><Store className="h-4 w-4" /> View PulcipStore <ArrowUpRight className="h-4 w-4" /></a></Button>
      </section>

      <footer className="landing-footer"><span>Pulcip Members</span><span>Discord growth with visibility and control.</span></footer>
    </main>
  );
}
