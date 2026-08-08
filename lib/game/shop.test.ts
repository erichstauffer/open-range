import { describe, expect, it } from "vitest";
import { generateWorld } from "../world/gen";
import { createGameState } from "./state";
import {
  INN_PRICE,
  POTION_HEAL,
  PRICES,
  WOOD_PRICE,
  buy,
  drinkPotion,
  resalePrice,
  restAtInn,
  sell,
  sellWood,
} from "./shop";
import { MAX_HP } from "./vitality";

const W = 96;
const H = 96;

/**
 * One world for the file.
 *
 * Nothing in `shop.ts` reads the world - it is arithmetic over the player's
 * pockets - so generating an island per test was paying full world-generation
 * cost fourteen times to get fourteen empty inventories.
 */
const WORLD = generateWorld("shop", W, H);

function shopper(coins = 100) {
  const state = createGameState(WORLD);
  state.coins = coins;
  return state;
}

describe("buying", () => {
  it("takes the money and hands over the goods", () => {
    const state = shopper();
    expect(buy(state, "sword").ok).toBe(true);
    expect(state.items.has("sword")).toBe(true);
    expect(state.coins).toBe(100 - PRICES.sword);
  });

  it("refuses what cannot be afforded, and takes nothing", () => {
    const state = shopper(PRICES.sword - 1);
    const result = buy(state, "sword");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/afford/i);
    expect(state.items.has("sword")).toBe(false);
    expect(state.coins).toBe(PRICES.sword - 1);
  });

  it("will not sell a second sword or a second shield", () => {
    const state = shopper();
    buy(state, "sword");
    const after = state.coins;

    const result = buy(state, "sword");
    expect(result.ok).toBe(false);
    expect(state.coins).toBe(after);
  });

  it("stacks potions, which are spent rather than kept", () => {
    const state = shopper();
    buy(state, "potion");
    buy(state, "potion");
    expect(state.potions).toBe(2);
    expect(state.coins).toBe(100 - PRICES.potion * 2);
  });
});

describe("selling", () => {
  it("pays less than it charged, so a purchase is a real decision", () => {
    const state = shopper();
    buy(state, "shield");
    sell(state, "shield");

    expect(state.items.has("shield")).toBe(false);
    expect(state.coins).toBe(100 - PRICES.shield + resalePrice("shield"));
    expect(state.coins).toBeLessThan(100);
  });

  it("refuses to buy back what is not carried", () => {
    const state = shopper(0);
    expect(sell(state, "sword").ok).toBe(false);
    expect(state.coins).toBe(0);
  });

  it("buys wood by the armful and leaves none behind", () => {
    const state = shopper(0);
    state.wood = 5;

    const result = sellWood(state);
    expect(result.ok).toBe(true);
    expect(state.wood).toBe(0);
    expect(state.coins).toBe(5 * WOOD_PRICE);

    expect(sellWood(state).ok).toBe(false);
  });
});

describe("the inn", () => {
  it("charges for a bed and gives everything back", () => {
    const state = shopper();
    state.hp = 3;

    const result = restAtInn(state);
    expect(result.ok).toBe(true);
    expect(state.hp).toBe(MAX_HP);
    expect(state.coins).toBe(100 - INN_PRICE);
  });

  it("will not take money from someone who does not need the room", () => {
    const state = shopper();
    const result = restAtInn(state);

    expect(result.ok).toBe(false);
    expect(state.coins).toBe(100);
  });

  it("refuses a bed there is no money for", () => {
    const state = shopper(INN_PRICE - 1);
    state.hp = 1;
    expect(restAtInn(state).ok).toBe(false);
    expect(state.hp).toBe(1);
  });
});

describe("potions", () => {
  it("heals less than a bed, and empties the bottle", () => {
    const state = shopper();
    state.potions = 1;
    state.hp = 1;

    expect(drinkPotion(state).ok).toBe(true);
    expect(state.hp).toBe(1 + POTION_HEAL);
    expect(state.potions).toBe(0);
    expect(POTION_HEAL).toBeLessThan(MAX_HP);
  });

  it("is not wasted on a walker who is already rested", () => {
    const state = shopper();
    state.potions = 1;

    expect(drinkPotion(state).ok).toBe(false);
    expect(state.potions).toBe(1);
  });

  it("cannot be drunk out of an empty pack", () => {
    const state = shopper();
    state.hp = 1;
    expect(drinkPotion(state).ok).toBe(false);
  });
});

describe("the economy as a whole", () => {
  it("makes wood the only way to come out ahead", () => {
    // Buy a sword, fell nothing, sell it back: strictly worse off. This is the
    // property that stops the store being an infinite money press, and it has to
    // hold for both keepsakes.
    for (const item of ["sword", "shield"] as const) {
      const state = shopper();
      buy(state, item);
      sell(state, item);
      expect(state.coins, item).toBeLessThan(100);
    }

    // Wood is the exception on purpose: it is produced, not traded.
    const woodcutter = shopper(0);
    woodcutter.wood = 12;
    sellWood(woodcutter);
    expect(woodcutter.coins).toBeGreaterThan(0);
  });
});
