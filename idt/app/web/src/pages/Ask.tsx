import { useMutation } from "@tanstack/react-query";
import { ExternalLink, SendHorizontal } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api.ts";
import { Page } from "../components/AppShell.tsx";
import { Banner, Button, Card, Label, Spinner } from "../components/ui.tsx";
import { etDate, etDateLabel, etStamp, pct, price, venueMeta, type AskResponse } from "../idt.ts";

const EXAMPLES = [
  "Why did BTC's implied median drop overnight?",
  "What moved ETH's distribution in the last 24 hours?",
  "Why did the chance of BTC finishing above spot change yesterday?",
];

function withCitations(text: string, prefix: string): ReactNode[] {
  return text.split(/(\[[EP]\d+\])/g).map((part, i) => {
    const m = part.match(/^\[([EP]\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const ref = m[1]!;
    return (
      <a
        key={i}
        href={`#${prefix}-${ref}`}
        className={`mx-0.5 rounded-md px-1.5 py-0.5 font-mono text-xs no-underline ${
          ref.startsWith("P") ? "bg-cyan/15 text-cyan" : "bg-violet/15 text-violet"
        }`}
      >
        {ref}
      </a>
    );
  });
}

function Answer({ r, n }: { r: AskResponse; n: number }) {
  const prefix = `a${n}`;
  const cited = new Set(r.cited ?? []);
  const asset = r.numbers[0]?.asset ?? r.state[0]?.asset ?? "BTC";
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-faint">
          {r.window.label} · {etStamp(r.window.start)} → {etStamp(r.window.end)}
          {r.model ? ` · written by ${r.model} on Snowflake Cortex` : ""}
        </span>
        <span className="text-[15px] font-bold">{r.question}</span>
      </div>

      <p className={`m-0 text-[15px] leading-relaxed ${r.refused ? "text-muted" : "text-text"}`}>{withCitations(r.answer, prefix)}</p>

      {r.warnings.length > 0 && (
        <Banner title="Grounding checks changed this answer">
          {r.warnings.join(" · ")}
        </Banner>
      )}

      {(r.numbers.length > 0 || r.state.length > 0) && (
        <div className="flex flex-col gap-2">
          <Label>The numbers · straight from Snowflake, not from the model</Label>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  {["", "Ladder", "Window", "Median", "P(above level)", "Snapshots"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.numbers.map((e) => (
                  <tr key={e.ref} id={`${prefix}-${e.ref}`} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-mono text-violet">{e.ref}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ background: venueMeta(e.venue).color }} />
                        {e.asset} {venueMeta(e.venue).label} · {etDateLabel(etDate(e.resolution_at))}
                      </span>
                      {e.source === "backfill" && <span className="text-xs text-amber">reconstructed</span>}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {etStamp(e.window_start)} → {etStamp(e.window_end)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {price(e.median_before, e.asset)} → {price(e.median_after, e.asset)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {pct(e.p_before)} → {pct(e.p_after)}
                      <span className="block text-xs text-faint">above {price(e.level, e.asset)}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-faint">
                      {e.prev_snapshot_id.slice(0, 8)}
                      <br />
                      {e.snapshot_id.slice(0, 8)}
                    </td>
                  </tr>
                ))}
                {r.state.map((s) => (
                  <tr key={s.ref} id={`${prefix}-${s.ref}`} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-violet">{s.ref}</td>
                    <td className="px-3 py-2">
                      {s.asset} {venueMeta(s.venue).label} · {etDateLabel(etDate(s.resolution_at))}
                    </td>
                    <td className="px-3 py-2 text-muted">latest, {etStamp(s.taken_at)}</td>
                    <td className="px-3 py-2 font-mono">{price(s.quantiles.find((q) => Math.abs(q.q - 0.5) < 1e-9)?.value, s.asset)}</td>
                    <td className="px-3 py-2 font-mono">{pct(s.p_above_spot?.prob)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-faint">{s.snapshot_id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {r.posts.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Posts retrieved from Snowflake by similarity</Label>
          {r.posts.map((p) => (
            <div
              key={p.ref}
              id={`${prefix}-${p.ref}`}
              className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3 ${cited.has(p.ref) ? "border-cyan/40" : "border-line opacity-70"}`}
            >
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-cyan">{p.ref}</span>
                  <span className="text-text">@{p.author ?? "unknown"}</span>
                  {!cited.has(p.ref) && <span className="text-xs text-faint">not cited</span>}
                </span>
                <span className="flex items-center gap-3 text-xs text-faint">
                  <span>{p.modes.join(" + ")}</span>
                  <span>similarity {p.sim.toFixed(2)}</span>
                  <span className={p.in_window ? "text-up" : ""}>{p.in_window ? "inside window" : "outside window"}</span>
                  {etStamp(p.posted_at)}
                  <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1">
                    X <ExternalLink aria-hidden className="size-3" />
                  </a>
                </span>
              </div>
              <p className="m-0 text-sm text-muted">{p.text ? `“${p.text}”` : "Link only: Grok didn't return this post's text."}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-faint">
        {r.caveats.map((c) => (
          <span key={c}>{c}</span>
        ))}
        <span>Prices are quoted for {asset}; this is analysis of market data, not investment advice.</span>
      </div>
    </Card>
  );
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AskResponse[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api<AskResponse>("/api/idt/ask", { method: "POST", body: { question: q } }),
    onSuccess: (r) => {
      setHistory((h) => [r, ...h]);
      setQuestion("");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (question.trim().length >= 3) ask.mutate(question.trim());
  }

  return (
    <Page title="Ask" subtitle="Questions answered only from stored snapshots and X posts, with every claim cited.">
      <Card className="flex flex-col gap-3 p-5">
        <form onSubmit={submit} className="m-0 flex gap-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Why did BTC's December median drop this morning?"
            maxLength={500}
            aria-label="Question"
            className="h-12 flex-1 rounded-xl border border-edge bg-ink px-4 text-[15px] text-text outline-none focus:border-muted"
          />
          <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
            <SendHorizontal aria-hidden className="size-4" />
            Ask
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={ask.isPending}
              onClick={() => ask.mutate(ex)}
              className="cursor-pointer rounded-xl border border-edge bg-transparent px-3 py-1.5 text-[13px] text-muted hover:text-text disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </Card>

      {ask.isPending && <Spinner label="Retrieving from Snowflake and writing a grounded answer" />}
      {ask.error && <Banner tone="error" title="Couldn't answer">{ask.error.message}</Banner>}
      {history.map((r, i) => (
        <Answer key={history.length - i} r={r} n={history.length - i} />
      ))}
    </Page>
  );
}
