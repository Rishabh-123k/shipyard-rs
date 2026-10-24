import { Link } from "react-router";
import { AuthLayout, CredentialsForm } from "../components/AppShell.tsx";

export function SignIn() {
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your IDT account.">
      <CredentialsForm endpoint="/api/login" submitLabel="Sign in" newPassword={false} />
      <p className="m-0 -mt-2 text-right text-[13px]">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p className="m-0 text-center text-sm text-muted">
        New to IDT? <Link to="/signup">Open an account</Link>
      </p>
    </AuthLayout>
  );
}
