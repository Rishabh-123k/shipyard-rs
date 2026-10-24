import { Link } from "react-router";
import { AuthLayout, CredentialsForm } from "../components/AppShell.tsx";

export function SignUp() {
  return (
    <AuthLayout title="Open your account" subtitle="Takes about a minute. Your wallets are created for you.">
      <CredentialsForm endpoint="/api/signup" submitLabel="Create account" newPassword />
      <p className="m-0 text-center text-sm text-muted">
        Already a customer? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
