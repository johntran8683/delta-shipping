import { SignInForm } from "@/components/sign-in-form";
import { AuthShell } from "@/components/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your organization email and password to access delivery notes and shipping workflows."
      backLink={{ href: "/", label: "← Back to home" }}
      footer={
        <>
          © {new Date().getFullYear()} Delta Controls · Confidential internal use
        </>
      }
    >
      <SignInForm />
    </AuthShell>
  );
}
