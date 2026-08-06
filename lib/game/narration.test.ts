import { describe, expect, it, vi } from "vitest";
import type { GameState } from "./state";
import {
  ConversationNarrator,
  narrationTargetForDialog,
  narrationTargetForInteraction,
} from "./narration";

class FakeUtterance {
  private listeners = new Map<string, Array<() => void>>();

  constructor(readonly text: string) {}

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: "end" | "error"): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function setup() {
  const utterances: FakeUtterance[] = [];
  const engine = { cancel: vi.fn(), speak: vi.fn() };
  const narrator = new ConversationNarrator(
    engine as unknown as Pick<SpeechSynthesis, "cancel" | "speak">,
    (text) => {
      const utterance = new FakeUtterance(text);
      utterances.push(utterance);
      return utterance as unknown as SpeechSynthesisUtterance;
    },
  );
  return { engine, narrator, utterances };
}

describe("conversation narration", () => {
  it("trims and speaks exactly the supplied dialogue line", () => {
    const { engine, narrator, utterances } = setup();
    const states: boolean[] = [];
    narrator.speak("  Follow the river east.  ", (speaking) => states.push(speaking));
    expect(utterances[0]?.text).toBe("Follow the river east.");
    expect(engine.speak).toHaveBeenCalledWith(utterances[0]);
    expect(states).toEqual([false, true]);
    utterances[0]?.emit("end");
    expect(states).toEqual([false, true, false]);
  });

  it("cancels before replacement and ignores the old utterance's late end event", () => {
    const { engine, narrator, utterances } = setup();
    const states: boolean[] = [];
    const listen = (speaking: boolean) => states.push(speaking);
    narrator.speak("First", listen);
    narrator.speak("Second", listen);
    const beforeLateEnd = [...states];
    utterances[0]?.emit("end");
    expect(engine.cancel).toHaveBeenCalledTimes(2);
    expect(states).toEqual(beforeLateEnd);
    utterances[1]?.emit("error");
    expect(states.at(-1)).toBe(false);
  });

  it("does not restart a gesture-authorised line when React observes the same key", () => {
    const { engine, narrator } = setup();
    const states: boolean[] = [];
    const listen = (speaking: boolean) => states.push(speaking);
    narrator.speak("Follow the river east.", listen, "speaker:0");
    narrator.speak("Follow the river east.", listen, "speaker:0");
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(engine.speak).toHaveBeenCalledTimes(1);
    expect(states).toEqual([false, true]);
  });

  it("stops immediately and does not speak blank text", () => {
    const { engine, narrator } = setup();
    const states: boolean[] = [];
    narrator.speak("   ", (speaking) => states.push(speaking));
    narrator.stop((speaking) => states.push(speaking));
    expect(engine.speak).not.toHaveBeenCalled();
    expect(engine.cancel).toHaveBeenCalledTimes(2);
    expect(states).toEqual([false, false]);
  });
});

function gameState(overrides: Partial<GameState> = {}): GameState {
  return {
    dialog: null,
    nearbyInteraction: null,
    world: { npcs: [], landmarks: [] },
    ...overrides,
  } as unknown as GameState;
}

describe("interaction narration targets", () => {
  it("previews the first line when opening a character conversation", () => {
    const state = gameState({
      nearbyInteraction: { kind: "npc", id: "speaker", label: "Aster" },
      world: {
        npcs: [{ id: "speaker", lines: ["The ford lies east."] }],
        landmarks: [],
      } as unknown as GameState["world"],
    });
    expect(narrationTargetForInteraction(state)).toEqual({
      key: "speaker:0",
      text: "The ford lies east.",
    });
  });

  it("previews the next line of an open conversation", () => {
    const dialog = {
      sourceId: "speaker",
      name: "Aster",
      role: "ferryman",
      lines: ["First.", "Second."],
      index: 0,
    };
    const state = gameState({ dialog });
    expect(narrationTargetForDialog(dialog)).toEqual({ key: "speaker:0", text: "First." });
    expect(narrationTargetForInteraction(state)).toEqual({ key: "speaker:1", text: "Second." });
  });

  it("returns no target when the final line will close", () => {
    const state = gameState({
      dialog: {
        sourceId: "speaker",
        name: "Aster",
        role: "ferryman",
        lines: ["Only line."],
        index: 0,
      },
    });
    expect(narrationTargetForInteraction(state)).toBeNull();
  });

  it("previews the first line of a nearby landmark passage", () => {
    const state = gameState({
      nearbyInteraction: { kind: "landmark", id: "stone", label: "Old Stone" },
      world: {
        npcs: [],
        landmarks: [{ id: "stone", passage: ["The markings face north."] }],
      } as unknown as GameState["world"],
    });
    expect(narrationTargetForInteraction(state)).toEqual({
      key: "stone:0",
      text: "The markings face north.",
    });
  });
});
