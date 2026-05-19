import { useState } from "react";
import type { PasswordPromptState, Profile } from "../types/domain";

export function useSshPasswordPrompt() {
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null);
  const [passwordValue, setPasswordValue] = useState("");

  function requestSshPassword(profile: Profile) {
    return new Promise<string | null>((resolve) => {
      setPasswordValue("");
      setPasswordPrompt({ profile, resolve });
    });
  }

  function submitSshPassword() {
    const resolver = passwordPrompt?.resolve;
    const password = passwordValue;
    setPasswordPrompt(null);
    setPasswordValue("");
    resolver?.(password);
  }

  function cancelSshPassword() {
    const resolver = passwordPrompt?.resolve;
    setPasswordPrompt(null);
    setPasswordValue("");
    resolver?.(null);
  }

  return {
    passwordPrompt,
    passwordValue,
    setPasswordValue,
    requestSshPassword,
    submitSshPassword,
    cancelSshPassword,
  };
}
