import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useEffect, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { api, ApiError, useMe } from "../api.ts";
import type { Profile } from "../types.ts";
import { Banner, Button, Logo, Spinner } from "./ui.tsx";

// The bracketed letter is also a keyboard shortcut.
const NAV: { to: string; label: string; key: string }[] = [
  { to: "/", label: "Markets", key: "M" },
  { to: "/shifts", label: "Shifts", key: "S" },
  { to: "/ask", label: "Ask", key: "A" },
  { to: "/trade", label: "Trade", key: "T" },
  { to: "/journal", label: "Journal", key: "J" },
  { to: "/wallet", label: "Wallet", key: "W" },
  { to: "/add-funds", label: "Add funds", key: "F" },
  { to: "/send", label: "Send", key: "D" },
  { to: "/activity", label: "Activity", key: "Y" },
];

function useNavShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const item = NAV.find((n) => n.key === e.key.toUpperCase());
      if (item) {
        e.preventDefault();
        navigate(item.to);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

function CustomerCard({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await api("/api/logout", { method: "POST" });
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="mt-auto flex items-center gap-2.5 rounded-[18px] border border-edge bg-panel p-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center border border-edge font-mono text-[12px] uppercase">
        {email.slice(0, 2)}
      </div>
      <span className="min-w-0 flex-1 truncate text-xs text-muted" title={email}>
        {email}
      </span>
      <button type="button" onClick={signOut} aria-label="Sign out" className="flex text-muted hover:text-text">
        <LogOut aria-hidden className="size-[18px]" />
      </button>
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  useNavShortcuts();

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
  if (me.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (me.error) {
    return (
      <div className="mx-auto max-w-lg p-12">
        <Banner tone="error" title="cryptoshi is unreachable">
          {me.error.message}
        </Banner>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-[1100px]">
      <aside className="flex w-[232px] shrink-0 flex-col gap-8 border-r border-edge bg-night/95 px-4 py-6">
        <Logo />
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ to, label, key }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-keyshortcuts={key}
              className={({ isActive }) =>
                `flex h-10 items-center gap-2.5 px-2 font-mono text-[14px] no-underline ${
                  isActive ? "bg-text text-ink hover:text-ink" : "text-muted hover:bg-line hover:text-text"
                }`
              }
            >
              <span aria-hidden className="opacity-70">[{key}]</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <CustomerCard email={me.data.email} />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-7 px-12 py-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function BrandArt() {
  return (
    <div aria-hidden className="pointer-events-none relative mt-auto w-full max-w-[520px] border border-text bg-ink p-3">
      <div className="flex items-center justify-between border-b border-edge pb-2 font-mono text-[11px] text-faint">
        <span>cryptoshi — terminal</span>
        <span>● ● ●</span>
      </div>
      <pre className="m-0 pt-3 font-mono text-[12px] leading-relaxed text-muted">
        {`> fit kalshi BTC 2026-10-30
  strikes 50 · coherence 0.0050
  P(BTC > spot) ............ 52.7%
  median ................ $79,893
> grok x_search --window 60m
  posts 37 · lean negative
  crowd vs market .... divergent
> `}
        <span className="inline-block h-[1em] w-[0.6em] animate-pulse bg-text align-[-0.15em]" />
      </pre>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full grid-cols-2">
      <section className="relative flex flex-col gap-10 overflow-hidden border-r border-line bg-night px-14 py-12">
        <Logo />
        <div className="relative flex max-w-[520px] flex-col gap-4">
          <h1 className="m-0 font-display text-[52px] leading-[1.02] font-bold tracking-[-0.03em]">See what the market thinks happens next.</h1>
          <p className="m-0 text-lg leading-snug text-muted">
            Price distributions implied by Polymarket and Kalshi, the X posts that moved them, and a wallet to act on it.
          </p>
        </div>
        <BrandArt />
      </section>
      <section className="flex items-center justify-center p-12">
        <div className="flex w-[400px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="m-0 font-display text-[26px] font-bold">{title}</h2>
            <p className="m-0 text-[15px] text-muted">{subtitle}</p>
          </div>
          {children}
          <p className="m-0 text-center text-xs text-faint">cryptoshi's wallet is forked from True Markets' Tensho example and runs on True Markets gateway rails.</p>
        </div>
      </section>
    </div>
  );
}

const INPUT = "h-12 border border-edge bg-panel px-3.5 text-base text-text outline-none focus:border-muted";

export function CredentialsForm({
  endpoint,
  submitLabel,
  newPassword,
}: {
  endpoint: "/api/signup" | "/api/login";
  submitLabel: string;
  newPassword: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const submit = useMutation({
    mutationFn: (body: { email: string; password: string }) => api<Profile>(endpoint, { method: "POST", body }),
    onSuccess: (profile) => {
      queryClient.setQueryData(["me"], profile);
      navigate("/", { replace: true });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submit.mutate({ email: String(form.get("email")), password: String(form.get("password")) });
  }

  return (
    <form onSubmit={onSubmit} className="m-0 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] text-muted">
        Email
        <input name="email" type="email" required autoComplete="email" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] text-muted">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={newPassword ? 8 : undefined}
          autoComplete={newPassword ? "new-password" : "current-password"}
          className={INPUT}
        />
      </label>
      {submit.error && <p role="alert" className="m-0 text-sm text-down">{submit.error.message}</p>}
      <Button type="submit" disabled={submit.isPending} className="h-[52px]">
        {submit.isPending ? "One moment…" : submitLabel}
      </Button>
    </form>
  );
}

export function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <>
      <header className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[34px] font-bold tracking-[-0.03em]">{title}</h1>
          <p className="m-0 text-[15px] text-muted">{subtitle}</p>
        </div>
        <span className="flex h-8 shrink-0 items-center gap-2 border border-edge bg-ink px-3 font-mono text-[12px] text-muted">
          <span className="size-2 rounded-full bg-up" />
          Markets open · 24/7
        </span>
      </header>
      {children}
    </>
  );
}
