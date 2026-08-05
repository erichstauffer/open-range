import { describe, expect, it, vi } from "vitest";
import { ConversationNarrator } from "./narration";

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
