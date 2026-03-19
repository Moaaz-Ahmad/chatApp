import { useState } from "react";
import "./LoginForm.css";

const TABS = ["login", "register"];

export default function LoginForm({ onLogin, onRegister }) {
  const [tab, setTab]         = useState("login");
  const [fields, setFields]   = useState({ email: "", username: "", displayName: "", password: "" });
  const [error, setError]     = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const update = (field) => (e) => setFields((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (tab === "login") {
        await onLogin({ email: fields.email, password: fields.password });
      } else {
        await onRegister({
          email: fields.email,
          username: fields.username,
          displayName: fields.displayName || undefined,
          password: fields.password,
        });
      }
    } catch (err) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-backdrop">
      <div className="auth-card">
        <div className="auth-logo">
          <svg viewBox="0 0 32 32" fill="none" width="36" height="36">
            <rect width="32" height="32" rx="10" fill="var(--accent)" />
            <path
              d="M8 10h16M8 16h10M8 22h6"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="auth-logo__name">ChatApp</span>
        </div>

        <div className="auth-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`auth-tab ${tab === t ? "auth-tab--active" : ""}`}
              onClick={() => { setTab(t); setError(null); }}
            >
              {t === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {tab === "register" && (
            <>
              <div className="auth-field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="yourhandle"
                  value={fields.username}
                  onChange={update("username")}
                  required
                  minLength={3}
                  disabled={isLoading}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="displayName">Display name <span className="auth-optional">(optional)</span></label>
                <input
                  id="displayName"
                  type="text"
                  placeholder="Alex Kim"
                  value={fields.displayName}
                  onChange={update("displayName")}
                  disabled={isLoading}
                />
              </div>
            </>
          )}

          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={fields.email}
              onChange={update("email")}
              required
              disabled={isLoading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              placeholder={tab === "register" ? "Min. 8 characters" : "••••••••"}
              value={fields.password}
              onChange={update("password")}
              required
              minLength={8}
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="auth-error" role="alert">
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0V5zM8 11.5a.875.875 0 110 1.75.875.875 0 010-1.75z" />
              </svg>
              {error}
            </div>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={isLoading}
          >
            {isLoading
              ? <span className="auth-submit__spinner" />
              : tab === "login" ? "Sign In" : "Create account"
            }
          </button>
        </form>

        <p className="auth-switch">
          {tab === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            className="auth-switch__btn"
            onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(null); }}
          >
            {tab === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
