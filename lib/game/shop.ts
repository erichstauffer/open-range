/**
 * The economy, as arithmetic.
 *
 * Nothing here touches the renderer, the input queue or React. Every operation
 * is a function from a `GameState` and a request to a result, which is what lets
 * `shop.test.ts` prove the invariants that actually matter - you cannot buy what
 * you cannot afford, you cannot own two swords, and selling something you do not
 * have is not a way to make money - without a browser or a shop panel existing.
 *
 * There are four things in the world worth a coin:
 *
 *  - a SWORD, which fells trees. The only tool in the game that changes the
 *    island rather than the player's access to it.
 *  - a SHIELD, which is worn. It has no mechanical effect and is not pretending
 *    to: there is nothing to be defended from, and the honest version of a
 *    shield in a game with no combat is a thing you carry because you have it.
 *  - a POTION, which buys back weariness in a bottle.
 *  - WOOD, which the player produces and the store buys. It is the only income
 *    that is not a gift, and it is what makes the sword pay for itself.
 */

import { heal, MAX_HP } from "./vitality";
import type { GameState } from "./state";

/** Things the store sells. Wood goes the other way. */
export type ShopItem = "sword" | "shield" | "potion";

export const SHOP_ITEMS: readonly ShopItem[] = ["sword", "shield", "potion"];

/**
 * Kept once, not stocked.
 *
 * A second sword would do nothing a first one does not, so the store will not
 * sell you one - and it will buy the first one back, which is the player's way
 * out of a purchase they regret.
 */
export const KEEPSAKES: ReadonlySet<ShopItem> = new Set<ShopItem>(["sword", "shield"]);

export const PRICES: Readonly<Record<ShopItem, number>> = {
  sword: 24,
  shield: 18,
  potion: 6,
};

/**
 * What the store pays.
 *
 * Two thirds, rounded down. A store that bought at its selling price would make
 * the sword free - buy, fell a tree, sell it back - and one that paid nothing
 * would make an accidental purchase permanent.
 */
export function resalePrice(item: ShopItem): number {
  return Math.floor((PRICES[item] * 2) / 3);
}

/** What the store pays for an armful of wood. */
export const WOOD_PRICE = 3;

/** What a night at the inn costs, and what it gives back. */
export const INN_PRICE = 5;

/** Points a potion returns. Deliberately less than a bed. */
export const POTION_HEAL = 8;

/** Wood from one felled tree. */
export const WOOD_PER_TREE = 2;

export interface ShopResult {
  ok: boolean;
  /** Said out loud to the player when the answer is no, or when it is yes. */
  message: string;
}

const NO_MONEY = "You cannot afford that.";

export function canBuy(state: GameState, item: ShopItem): boolean {
  if (KEEPSAKES.has(item) && state.items.has(item)) return false;
  return state.coins >= PRICES[item];
}

export function buy(state: GameState, item: ShopItem): ShopResult {
  if (KEEPSAKES.has(item) && state.items.has(item)) {
    return { ok: false, message: `You already have a ${item}.` };
  }
  if (state.coins < PRICES[item]) return { ok: false, message: NO_MONEY };

  state.coins -= PRICES[item];
  if (KEEPSAKES.has(item)) state.items.add(item);
  else state.potions += 1;

  return { ok: true, message: `Bought a ${item} for ${PRICES[item]}.` };
}

export function canSell(state: GameState, item: ShopItem): boolean {
  return KEEPSAKES.has(item) ? state.items.has(item) : state.potions > 0;
}

export function sell(state: GameState, item: ShopItem): ShopResult {
  if (!canSell(state, item)) return { ok: false, message: `You have no ${item} to sell.` };

  const price = resalePrice(item);
  state.coins += price;
  if (KEEPSAKES.has(item)) state.items.delete(item);
  else state.potions -= 1;

  return { ok: true, message: `Sold a ${item} for ${price}.` };
}

export function sellWood(state: GameState, amount = state.wood): ShopResult {
  const armfuls = Math.min(state.wood, Math.max(0, Math.floor(amount)));
  if (armfuls === 0) return { ok: false, message: "You are carrying no wood." };

  state.wood -= armfuls;
  const paid = armfuls * WOOD_PRICE;
  state.coins += paid;
  return { ok: true, message: `Sold ${armfuls} wood for ${paid}.` };
}

/**
 * A night at the inn.
 *
 * Refuses to charge a walker who is already rested, which is the whole reason
 * `heal` reports what it actually restored rather than what it was asked for.
 */
export function restAtInn(state: GameState): ShopResult {
  if (state.hp >= state.maxHp) return { ok: false, message: "You do not need a bed yet." };
  if (state.coins < INN_PRICE) return { ok: false, message: NO_MONEY };

  state.coins -= INN_PRICE;
  const recovered = heal(state, MAX_HP);
  return { ok: true, message: `You sleep, and wake with ${recovered} back in your legs.` };
}

export function drinkPotion(state: GameState): ShopResult {
  if (state.potions === 0) return { ok: false, message: "You have no potion." };
  if (state.hp >= state.maxHp) return { ok: false, message: "You are not tired enough to waste it." };

  state.potions -= 1;
  const recovered = heal(state, POTION_HEAL);
  return { ok: true, message: `The bottle empties. ${recovered} back in your legs.` };
}
