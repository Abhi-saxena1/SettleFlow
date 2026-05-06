"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, LogIn, UserPlus, X } from "lucide-react";
import { clearTestAuthData, forgotPassword, logIn, resetPassword, signUp } from "../lib/api";
import { clearSettleFlowStorage } from "../lib/authSession";

const initialForm = {
  name: "",
  company: "",
  email: "",
  password: "",
  resetCode: ""
};

export default function AuthModal({ mode, onClose, onSuccess }) {
  const [activeMode, setActiveMode] = useState(mode || "login");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setActiveMode(mode || "login");
    setError("");
    setNotice("");
  }, [mode]);

  if (!mode) {
    return null;
  }

  const isSignup = activeMode === "signup";
  const isForgot = activeMode === "forgot";
  const isReset = activeMode === "reset";

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitAuth(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    try {
      if (isForgot) {
        const result = await forgotPassword({ email: form.email });
        setNotice(result.message);
        setActiveMode("reset");
        return;
      }

      if (isReset) {
        const result = await resetPassword({
          email: form.email,
          resetCode: form.resetCode,
          password: form.password
        });
        setNotice(result.message);
        setActiveMode("login");
        return;
      }

      const payload = isSignup ? form : { email: form.email, password: form.password };
      const result = isSignup ? await signUp(payload) : await logIn(payload);
      onSuccess(result);
      setForm(initialForm);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetTestAuth() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      await clearTestAuthData();
      clearSettleFlowStorage();
      setForm(initialForm);
      setActiveMode("signup");
      setNotice("Test login data cleared. Create a fresh account now.");
    } catch (err) {
      clearSettleFlowStorage();
      setError(`${err.message} Browser login cache was still cleared.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-start overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm sm:place-items-center sm:py-8">
      <div className="my-auto w-full max-w-md overflow-hidden rounded-[1.5rem] border border-black/10 bg-white shadow-glow">
        <div className="flex items-center justify-between border-b border-black/10 bg-[#f8fbef] px-6 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-leaf">
              {isSignup ? "Create account" : isForgot || isReset ? "Account recovery" : "Welcome back"}
            </p>
            <h2 className="mt-1 text-2xl font-black text-ink">
              {isSignup ? "Sign up for SettleFlow" : isForgot ? "Reset your password" : isReset ? "Enter reset code" : "Log in to SettleFlow"}
            </h2>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm hover:-translate-y-0.5">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3">
          <button
            type="button"
            onClick={() => setActiveMode("login")}
            className={`rounded-full px-4 py-2 text-sm font-black ${activeMode === "login" ? "bg-ink text-white" : "bg-sage text-ink"}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setActiveMode("signup")}
            className={`rounded-full px-4 py-2 text-sm font-black ${isSignup ? "bg-ink text-white" : "bg-sage text-ink"}`}
          >
            Sign Up
          </button>
        </div>

        <div className="px-6 pb-3">
          <button
            type="button"
            onClick={resetTestAuth}
            disabled={loading}
            className="w-full rounded-full border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:-translate-y-0.5 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reset test login data
          </button>
        </div>

        <form onSubmit={submitAuth} className="grid max-h-[calc(100vh-13rem)] gap-3 overflow-y-auto px-6 pb-6 pr-5 sm:max-h-none sm:gap-4 sm:overflow-visible sm:pr-6">
          {isSignup && (
            <>
              <label className="grid gap-2 text-sm font-bold text-black/55">
                Name
                <input
                  required
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
                  placeholder="Avery Stone"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-black/55">
                Company
                <input
                  value={form.company}
                  onChange={(event) => updateField("company", event.target.value)}
                  className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
                  placeholder="Northstar Retail"
                />
              </label>
            </>
          )}

          <label className="grid gap-2 text-sm font-bold text-black/55">
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
              placeholder="you@company.com"
            />
          </label>

          {isReset && (
            <label className="grid gap-2 text-sm font-bold text-black/55">
              Reset code
              <input
                required
                value={form.resetCode}
                onChange={(event) => updateField("resetCode", event.target.value)}
                className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
                placeholder="6 digit code"
              />
            </label>
          )}

          {!isForgot && (
          <label className="grid gap-2 text-sm font-bold text-black/55">
            Password
            <input
              required
              minLength={6}
              type="password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
              placeholder="At least 6 characters"
            />
          </label>
          )}

          {activeMode === "login" && (
            <button
              type="button"
              onClick={() => setActiveMode("forgot")}
              className="justify-self-start rounded-full bg-sage px-4 py-2 text-sm font-black text-leaf underline transition hover:-translate-y-0.5"
            >
              Forgot password?
            </button>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
              {notice}
            </div>
          )}

          <button className="button-primary w-full gap-2" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={18} /> : isSignup ? <UserPlus size={18} /> : isForgot || isReset ? <KeyRound size={18} /> : <LogIn size={18} />}
            {isSignup ? "Create Account" : isForgot ? "Send Reset Code" : isReset ? "Reset Password" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
