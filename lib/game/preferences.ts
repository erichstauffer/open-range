const CONTROLS_HELP_KEY = "open-range:controls-help-dismissed";
const READ_ALOUD_KEY = "open-range:read-aloud";

export function controlsHelpDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(CONTROLS_HELP_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissControlsHelp(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CONTROLS_HELP_KEY, "1");
  } catch {
    // A denied or full storage area should not make the controls unusable.
  }
}

/** Conversation narration is opt-in and deliberately separate from a world save. */
export function getReadAloudEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(READ_ALOUD_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReadAloudEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(READ_ALOUD_KEY, enabled ? "1" : "0");
  } catch {
    // A denied or full storage area should not make conversations unusable.
  }
}
