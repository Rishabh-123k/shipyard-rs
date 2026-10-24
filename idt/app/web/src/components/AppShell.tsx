import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeftRight, ChartSpline, History, LogOut, MessageSquareText, NotebookPen, Plus, Send, Wallet, type LucideIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { api, ApiError, useMe } from "../api.ts";
import type { Profile } from "../types.ts";
import { Banner, Button, Logo, Spinner } from "./ui.tsx";

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Markets", icon: ChartSpline },
  { to: "/shifts", label: "Shifts", icon: History },
  { to: "/ask", label: "Ask", icon: MessageSquareText },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/trade", label: "Trade", icon: ArrowLeftRight },
  { to: "/journal", label: "Journal", icon: NotebookPen },
  { to: "/add-funds", label: "Add funds", icon: Plus },
  { to: "/send", label: "Send", icon: Send },
  { to: "/activity", label: "Activity", icon: Activity },
];

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
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-edge text-[13px] font-bold uppercase">
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
        <Banner tone="error" title="Tensho is unreachable">
          {me.error.message}
        </Banner>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-[1100px]">
      <aside className="flex w-[248px] shrink-0 flex-col gap-8 border-r border-line bg-night px-[18px] py-7">
        <Logo />
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] no-underline ${
                  isActive ? "bg-line font-bold text-text hover:text-text" : "text-muted hover:text-text"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden className={`size-[18px] ${isActive ? "text-accent" : ""}`} />
                  {label}
                </>
              )}
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
  const rays = [0, 180, 360, 540, 720];
  const horizon: [number, number, number][] = [
    [320, 1.5, 1],
    [345, 1, 0.55],
    [380, 1, 0.4],
    [430, 1, 0.25],
  ];
  return (
    <svg viewBox="0 0 720 480" aria-hidden className="pointer-events-none absolute bottom-0 left-0 w-full">
      <circle cx="360" cy="250" r="150" fill="none" stroke="#FF4FA3" strokeWidth="2.5" />
      {[
        [215, 8],
        [250, 11],
        [288, 14],
      ].map(([y, width]) => (
        <line key={y} x1="180" y1={y} x2="540" y2={y} stroke="#0A0813" strokeWidth={width} />
      ))}
      <rect x="0" y="320" width="720" height="160" fill="#0A0813" />
      {horizon.map(([y, width, opacity]) => (
        <line key={y} x1="0" y1={y} x2="720" y2={y} stroke="#45E3FF" strokeWidth={width} opacity={opacity} />
      ))}
      {rays.map((x) => (
        <line key={x} x1="360" y1="320" x2={x} y2="480" stroke="#45E3FF" strokeWidth="1" opacity="0.35" />
      ))}
    </svg>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full grid-cols-2">
      <section className="relative flex flex-col gap-10 overflow-hidden border-r border-line bg-night px-14 py-12">
        <Logo />
        <div className="relative flex max-w-[520px] flex-col gap-4">
          <h1 className="m-0 font-display text-[44px] leading-[1.08] font-bold">See what the market thinks happens next.</h1>
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
          <p className="m-0 text-center text-xs text-faint">IDT's wallet is forked from True Markets' Tensho example and runs on True Markets gateway rails.</p>
        </div>
      </section>
    </div>
  );
}

const INPUT =
  "h-12 rounded-xl border border-edge bg-panel px-3.5 text-base text-text outline-none focus:border-muted";

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
          <h1 className="m-0 font-display text-[28px] font-bold">{title}</h1>
          <p className="m-0 text-[15px] text-muted">{subtitle}</p>
        </div>
        <span className="flex h-8 shrink-0 items-center gap-2 rounded-2xl border border-edge px-3.5 text-[13px] text-muted">
          <span className="size-2 rounded-full bg-up" />
          Markets open · 24/7
        </span>
      </header>
      {children}
    </>
  );
}
