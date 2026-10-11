import { TriangleAlert } from "lucide-react";

/** Shown on every person-level page in the demo. Every person in the demo is invented. */
export function SampleBanner() {
  return (
    <div role="note" className="flex max-w-3xl items-start gap-2 rounded-panel border border-line bg-amber-soft p-3 text-amber">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>Sample data. Every person on this page is invented and every address is from a documentation range. Nothing here was looked up. A real install starts with person-level identification off.</span>
    </div>
  );
}
