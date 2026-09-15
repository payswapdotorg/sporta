"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { loginAccount, registerAccount } from "@/lib/client-api";
import { ROUTES } from "@/lib/navigation";
import { StateChip } from "@/components/state-panels";

/**
 * The sign-in / register surface (W904): REAL forms wired to /api/auth/*.
 * Register self-selects from viewer/creator/analyst; sign-in issues the
 * HttpOnly session cookie. Errors are the API's classified messages.
 */
export function AuthForms() {
  const router = useRouter();
  const { refresh } = useAccount();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>(["viewer"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const account = await loginAccount({ username, password });
        await refresh();
        router.push(ROUTES.library);
      } else {
        await registerAccount({ username, password, roles: roles.length > 0 ? roles : undefined });
        const account = await loginAccount({ username, password });
        await refresh();
        setNotice(`Welcome, ${account.username} — you are signed in.`);
        router.push(ROUTES.library);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "the request failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleRole(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role],
    );
  }

  return (
    <section className="auth-surface" data-auth-mode={mode}>
      <div className="auth-tabs" role="tablist" aria-label="Authentication">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          className={`auth-tab ${mode === "signin" ? "active" : ""}`}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          className={`auth-tab ${mode === "register" ? "active" : ""}`}
          onClick={() => setMode("register")}
        >
          Create an account
        </button>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <div className="form-field">
          <label htmlFor="auth-username">Username</label>
          <input
            id="auth-username"
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <p className="field-hint">3–32 characters of letters, digits, dot, underscore or dash.</p>
        </div>
        <div className="form-field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 10 : 1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "register" && <p className="field-hint">At least 10 characters.</p>}
        </div>
        {mode === "register" && (
          <fieldset className="form-field role-picker">
            <legend>Your starting roles (you can hold several)</legend>
            {["viewer", "creator", "analyst"].map((role) => (
              <label key={role} className="role-picker-option">
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={() => toggleRole(role)}
                />
                <span>{role}</span>
              </label>
            ))}
            <p className="field-hint">
              Rights Holder and Operator grants are assigned by operators — self-registration
              cannot mint them.
            </p>
          </fieldset>
        )}
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="form-notice">
            <StateChip state="ready">signed in</StateChip>
            {notice}
          </p>
        )}
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account and sign in"}
        </button>
        <p className="auth-note">
          Sessions are opaque HttpOnly cookies. One account can hold many roles; the active role
          changes your workspace, never your authority.
        </p>
      </form>
    </section>
  );
}
