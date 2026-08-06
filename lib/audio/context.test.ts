import { afterEach, describe, expect, it, vi } from "vitest";
import { selectPlaybackAudioSession } from "./context";

describe("browser audio session", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects media playback when the Audio Session API is available", () => {
    const audioSession = { type: "ambient" };
    vi.stubGlobal("navigator", { audioSession });
    selectPlaybackAudioSession();
    expect(audioSession.type).toBe("playback");
  });

  it("degrades safely when the browser has no Audio Session API", () => {
    vi.stubGlobal("navigator", {});
    expect(() => selectPlaybackAudioSession()).not.toThrow();
  });

  it("does not break audio when the browser rejects the session type", () => {
    const audioSession = {
      get type() {
        return "ambient";
      },
      set type(_value: string) {
        throw new Error("unsupported");
      },
    };
    vi.stubGlobal("navigator", { audioSession });
    expect(() => selectPlaybackAudioSession()).not.toThrow();
  });
});
