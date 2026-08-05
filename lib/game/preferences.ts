const CONTROLS_HELP_KEY = "open-range:controls-help-dismissed";

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
