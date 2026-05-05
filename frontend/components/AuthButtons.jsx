"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, UserPlus } from "lucide-react";
import AuthModal from "./AuthModal";
import { AUTH_CHANGED_EVENT, clearSession, getStoredSession, saveSession } from "../lib/authSession";

export default function AuthButtons() {
  const [modalMode, setModalMode] = useState(null);
  const [user, setUser] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setUser(getStoredSession());

    function handleAuthChanged(event) {
      setUser(event.detail || getStoredSession());
    }

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener("storage", handleAuthChanged);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener("storage", handleAuthChanged);
    };
  }, []);

  function handleSuccess(result) {
    setUser(saveSession(result));
  }

  function logout() {
    clearSession();
  }

  if (user) {
    return (
      <button
        onClick={logout}
        className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:-translate-y-0.5 hover:shadow-md sm:inline-flex"
        title={`Logged in as ${user.email}`}
      >
        <LogOut size={16} />
        {user.name.split(" ")[0]}
      </button>
    );
  }

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        <button
          onClick={() => setModalMode("login")}
          className="rounded-full px-4 py-2 text-sm font-bold text-black/65 hover:bg-white hover:text-ink"
        >
          Login
        </button>
        <button
          onClick={() => setModalMode("signup")}
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:-translate-y-0.5 hover:shadow-md"
        >
          <UserPlus size={16} />
          Sign Up
        </button>
      </div>
      {mounted &&
        createPortal(
          <AuthModal mode={modalMode} onClose={() => setModalMode(null)} onSuccess={handleSuccess} />,
          document.body
        )}
    </>
  );
}
