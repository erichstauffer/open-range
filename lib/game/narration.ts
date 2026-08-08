import { ROBOT_ID, robotSpeech } from "../world/robot";
import type { DialogState, GameState } from "./state";

export type NarrationStateListener = (speaking: boolean) => void;

export interface NarrationTarget {
  /** Stable identity for one displayed line, used to prevent duplicate speech. */
  key: string;
  text: string;
}

type SpeechEngine = Pick<SpeechSynthesis, "cancel" | "speak">;

/**
 * Owns one system utterance at a time.
 *
 * The generation counter keeps a cancelled utterance's late end/error event
 * from changing the state of the line that replaced it.
 */
export class ConversationNarrator {
  private generation = 0;
  private activeKey: string | null = null;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance,
  ) {}

  speak(text: string, onStateChange: NarrationStateListener, key?: string): void {
    // A mobile tap starts the line synchronously, then React observes the same
    // dialogue on the next render. The effect may ask for that line again, but
    // restarting it would cancel the gesture-authorised utterance on iOS.
    if (key !== undefined && key === this.activeKey) return;

    this.stop(onStateChange);
    const trimmed = text.trim();
    if (!trimmed) return;

    const generation = ++this.generation;
    this.activeKey = key ?? null;
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
    this.activeKey = null;
    this.engine.cancel();
    onStateChange(false);
  }
}

export function narrationTargetForDialog(dialog: DialogState | null, index = dialog?.index): NarrationTarget | null {
  if (!dialog || index === undefined) return null;
  const text = dialog.lines[index]?.trim();
  if (!text) return null;
  return { key: `${dialog.sourceId}:${index}`, text };
}

/**
 * Preview the dialogue line an interact action will reveal.
 *
 * Touch browsers require speech to begin in the tap handler, one animation
 * frame before the queued action updates React. This mirrors the interaction's
 * visible result without mutating game state.
 */
export function narrationTargetForInteraction(state: GameState): NarrationTarget | null {
  if (state.dialog) return narrationTargetForDialog(state.dialog, state.dialog.index + 1);

  const nearby = state.nearbyInteraction;
  if (!nearby) return null;

  if (nearby.kind === "robot") {
    // Recomputed rather than remembered, and identical to what `interact` will
    // build one frame later because `robotSpeech` is pure in exactly these
    // arguments. Nothing here may advance `giftCount` or the recharge clock.
    const charged = state.elapsed >= state.robot.rechargeAt;
    const { lines } = robotSpeech(state.world.seed, state.robot.giftCount, charged);
    const text = lines[0]?.trim();
    return text ? { key: `${ROBOT_ID}:0`, text } : null;
  }

  if (nearby.kind === "npc") {
    const npc = state.world.npcs.find((candidate) => candidate.id === nearby.id);
    const text = npc?.lines[0]?.trim();
    return text ? { key: `${nearby.id}:0`, text } : null;
  }

  const landmark = state.world.landmarks.find((candidate) => candidate.id === nearby.id);
  const text = landmark?.passage[0]?.trim();
  return text ? { key: `${nearby.id}:0`, text } : null;
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
