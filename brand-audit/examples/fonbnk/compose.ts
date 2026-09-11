/** Composes the labelled Fonbnk BEFORE / AFTER comparison. */
import path from "node:path";
import { compose } from "../../scripts/compare";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/** Every figure here was measured off the two images (see build.ts). */
const NOTES = [
  "<b>Brand green corrected</b> — #02b966 → #00B74F across the logo, the “global commerce” accent and the CTA fill (ΔOKLab 0.025 → 0)",
  "<b>CTA label contrast</b> — white on green measured 2.58:1 (fails WCAG AA); now page ink on the canonical green at 7.27:1",
  "<b>Buttons normalised</b> — corner radius 6px → 8px per the guide; secondary button height matched to the primary (150 → 144 device px)",
  "<b>Secondary border</b> — undocumented #303238 (1.51:1) → documented Charcoal Gray #53565A (2.62:1)",
  "<b>Typography unchanged</b> — the H1 is already an editorial serif and UI/body already a geometric sans, so the guide's type rules were already met",
];

await compose(
  path.join(DIR, "before.png"),
  path.join(DIR, "after.png"),
  path.join(DIR, "fonbnk-brand-remediation.png"),
  {
    siteLabel: "fonbnk.com — homepage, iPhone Safari capture as supplied",
    beforeTitle: "Current Fonbnk website",
    afterTitle: "Brand-remediated version",
    notes: NOTES,
  },
);
console.log("wrote examples/fonbnk/fonbnk-brand-remediation.png");
