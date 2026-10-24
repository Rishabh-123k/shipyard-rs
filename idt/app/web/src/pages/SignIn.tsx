import { Link } from "react-router";
import { AuthLayout, CredentialsForm } from "../components/AppShell.tsx";

export function SignIn() {
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Tensho account.">
      <CredentialsForm endpoint="/api/login" submitLabel="Sign in" newPassword={false} />
      <p className="m-0 text-center text-sm text-muted">
        New to Tensho? <Link to="/signup">Open an account</Link>
      </p>
    </AuthLayout>
  );
}
