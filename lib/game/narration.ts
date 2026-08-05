export type NarrationStateListener = (speaking: boolean) => void;

type SpeechEngine = Pick<SpeechSynthesis, "cancel" | "speak">;

/**
 * Owns one system utterance at a time.
 *
 * The generation counter keeps a cancelled utterance's late end/error event
 * from changing the state of the line that replaced it.
 */
export class ConversationNarrator {
  private generation = 0;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance,
  ) {}

  speak(text: string, onStateChange: NarrationStateListener): void {
    this.stop(onStateChange);
    const trimmed = text.trim();
    if (!trimmed) return;

    const generation = ++this.generation;
    const utterance = this.makeUtterance(trimmed);
    const finish = () => {
      if (generation === this.generation) onStateChange(false);
    };
    utterance.addEventListener("end", finish, { once: true });
    utterance.addEventListener("error", finish, { once: true });
    onStateChange(true);
    this.engine.speak(utterance);
  }

  stop(onStateChange: NarrationStateListener): void {
    this.generation += 1;
    this.engine.cancel();
    onStateChange(false);
  }
}

export function createBrowserNarrator(): ConversationNarrator | null {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    !("SpeechSynthesisUtterance" in window)
  ) {
    return null;
  }
  return new ConversationNarrator(window.speechSynthesis, (text) => new window.SpeechSynthesisUtterance(text));
}
