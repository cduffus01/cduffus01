import { Wordmark } from "@/components/Wordmark";
import { UrlForm } from "@/components/UrlForm";
import { PageViewBeacon } from "@/components/PageViewBeacon";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[900px] flex-col px-5 sm:px-8">
      <PageViewBeacon name="home_view" />

      <header className="flex items-center justify-between py-7">
        <Wordmark />
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>
          V0 · free audit
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center pb-16 pt-10 sm:pt-16">
        <h1 className="max-w-[20ch] text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[62px]">
          See if your website is on-brand.
        </h1>
        <p
          className="mt-5 max-w-[52ch] text-[17px] leading-relaxed sm:text-[19px]"
          style={{ color: "var(--ink-soft)" }}
        >
          Paste your website. We&apos;ll find inconsistent fonts, colors, components and
          visual styles — and show you how to fix them.
        </p>

        <div className="mt-9 max-w-[640px]">
          <UrlForm />
        </div>

        <ol className="mt-16 grid gap-8 sm:mt-20 sm:grid-cols-3 sm:gap-10">
          {[
            { n: "1", t: "Scan", d: "We open your public site in a real browser and read how it's actually built." },
            { n: "2", t: "Score", d: "We measure typography, colors, components, visual style and accessibility." },
            { n: "3", t: "Preview", d: "See how your site looks with the inconsistencies fixed." },
          ].map((step) => (
            <li key={step.n}>
              <div
                className="mb-3 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {step.n}
              </div>
              <h2 className="text-[15px] font-semibold tracking-tight">{step.t}</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {step.d}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <footer
        className="border-t py-6 text-[13px]"
        style={{ borderColor: "var(--line)", color: "var(--muted)" }}
      >
        We analyze up to 4 public pages. Brand Score measures internal consistency, not taste.
      </footer>
    </main>
  );
}
