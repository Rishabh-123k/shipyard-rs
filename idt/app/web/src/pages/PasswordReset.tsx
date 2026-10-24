import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api.ts";
import { AuthLayout } from "../components/AppShell.tsx";
import { Banner, Button } from "../components/ui.tsx";
import type { Profile } from "../types.ts";

const INPUT = "h-12 border border-edge bg-panel px-3.5 text-base text-text outline-none focus:border-muted";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const forgot = useMutation({
    mutationFn: (body: { email: string }) => api<{ message: string }>("/api/password/forgot", { method: "POST", body }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    forgot.mutate({ email: email.trim() });
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll make a one-time link that works for 15 minutes.">
      {forgot.isSuccess ? (
        <Banner title="Check the server terminal">
          {forgot.data.message} Open that link in this browser to choose a new password.
        </Banner>
      ) : (
        <form onSubmit={submit} className="m-0 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
          </label>
          {forgot.error && <p role="alert" className="m-0 text-sm text-down">{forgot.error.message}</p>}
          <Button type="submit" disabled={forgot.isPending} className="h-[52px]">
            {forgot.isPending ? "One moment…" : "Make reset link"}
          </Button>
        </form>
      )}
      <p className="m-0 text-center text-sm text-muted">
        Remembered it? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reset = useMutation({
    mutationFn: (body: { token: string; password: string }) => api<Profile>("/api/password/reset", { method: "POST", body }),
    onSuccess: (profile) => {
      queryClient.clear();
      queryClient.setQueryData(["me"], profile);
      navigate("/", { replace: true });
    },
  });
  const mismatch = confirm.length > 0 && confirm !== password;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mismatch) reset.mutate({ token, password });
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link missing" subtitle="Open the full link printed in the server terminal.">
        <p className="m-0 text-center text-sm text-muted">
          <Link to="/forgot-password">Make a new reset link</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="This signs out every other session on your account.">
      <form onSubmit={submit} className="m-0 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          New password
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          Confirm new password
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT} />
        </label>
        {mismatch && <p className="m-0 text-sm text-down">The passwords don't match.</p>}
        {reset.error && (
          <p role="alert" className="m-0 text-sm text-down">
            {reset.error.message}. <Link to="/forgot-password">Make a new link</Link>
          </p>
        )}
        <Button type="submit" disabled={reset.isPending || mismatch} className="h-[52px]">
          {reset.isPending ? "One moment…" : "Set new password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
