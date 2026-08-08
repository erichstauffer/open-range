"use client";

import { UI } from "@/lib/art/palette";
import type { GameCommand } from "@/lib/game/input";
import {
  INN_PRICE,
  POTION_HEAL,
  PRICES,
  SHOP_ITEMS,
  WOOD_PRICE,
  resalePrice,
  type ShopItem,
} from "@/lib/game/shop";
import type { PublicState } from "@/lib/game/state";

/**
 * The counter.
 *
 * The one panel in the game with buttons that change the world, and it changes
 * nothing itself: every click is a `GameCommand` posted to the input queue, and
 * everything shown here comes back out of the next snapshot. React never reaches
 * into `GameState`, which is the same rule the joystick and the settings sliders
 * already keep - it is just more obviously load-bearing when the thing at stake
 * is the player's money.
 *
 * Refusals are shown rather than prevented. A button you cannot afford is
 * disabled, but a request the shop turns down for a reason worth hearing - you
 * are not tired enough for a bed, you already own a sword - comes back as a note
 * under the counter. Silently doing nothing would leave the player guessing.
 */

const ITEM_BLURB: Readonly<Record<ShopItem, string>> = {
  sword: "Fells a tree in one swing. You keep the wood.",
  shield: "Strapped to the back. It has never been needed here.",
  potion: `A bottle. Worth ${POTION_HEAL} back in your legs, wherever you open it.`,
};

export default function TownMenu({
  state,
  onCommand,
  onClose,
}: {
  state: PublicState;
  onCommand: (command: GameCommand) => void;
  onClose: () => void;
}) {
  const shop = state.shop;
  if (!shop) return null;

  const carries = (item: ShopItem) => (item === "potion" ? state.potions : state.items.includes(item) ? 1 : 0);

  return (
    <div
      className="overlay-layer absolute inset-0 grid place-items-center p-4"
      style={{ background: "rgba(14,16,22,0.86)" }}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-md px-6 py-5"
        style={{ background: "rgba(22,21,15,0.97)", border: `1px solid ${UI.inkSoft}` }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-xl" style={{ color: UI.parchment }}>
            {shop.name}
          </h2>
          <span className="ui-mono text-[10px] desktop-only" style={{ color: UI.inkSoft }}>
            esc to leave
          </span>
          <button type="button" className="overlay-action" onClick={onClose}>
            Leave
          </button>
        </div>
        <p className="ui-mono text-[11px] mb-4" style={{ color: UI.accent }}>
          {shop.role} · <span style={{ color: UI.inkSoft }}>you have {state.coins} coins</span>
        </p>

        {shop.note ? (
          <p
            className="ui-sans text-sm leading-relaxed rounded px-3 py-2 mb-4"
            style={{ background: "rgba(14,16,22,0.6)", color: UI.parchmentDim, border: `1px solid ${UI.nightSoft}` }}
            role="status"
          >
            {shop.note}
          </p>
        ) : null}

        {shop.kind === "inn" ? (
          <section className="space-y-3">
            <Row
              title="A bed for the night"
              detail={`${INN_PRICE} coins. You wake with everything back.`}
              action="Sleep"
              disabled={state.coins < INN_PRICE || state.hp >= state.maxHp}
              onAction={() => onCommand({ kind: "rest" })}
            />
            {state.potions > 0 ? (
              <Row
                title={`Open a potion (${state.potions} carried)`}
                detail={`${POTION_HEAL} back in your legs, and cheaper than a room.`}
                action="Drink"
                disabled={state.hp >= state.maxHp}
                onAction={() => onCommand({ kind: "drink" })}
              />
            ) : null}
          </section>
        ) : (
          <>
            <h3 className="ui-mono text-[11px] mb-2" style={{ color: UI.inkSoft }}>
              for sale
            </h3>
            <section className="space-y-3 mb-5">
              {SHOP_ITEMS.map((item) => (
                <Row
                  key={item}
                  title={`${item[0].toUpperCase()}${item.slice(1)}${carries(item) ? ` · carrying ${carries(item)}` : ""}`}
                  detail={`${PRICES[item]} coins. ${ITEM_BLURB[item]}`}
                  action="Buy"
                  disabled={state.coins < PRICES[item] || (item !== "potion" && carries(item) > 0)}
                  onAction={() => onCommand({ kind: "buy", item })}
                />
              ))}
            </section>

            <h3 className="ui-mono text-[11px] mb-2" style={{ color: UI.inkSoft }}>
              he buys
            </h3>
            <section className="space-y-3">
              <Row
                title={`Wood · ${state.wood} armful${state.wood === 1 ? "" : "s"}`}
                detail={`${WOOD_PRICE} coins each. Cut it yourself; he will not ask where.`}
                action={`Sell all (${state.wood * WOOD_PRICE})`}
                disabled={state.wood === 0}
                onAction={() => onCommand({ kind: "sellWood" })}
              />
              {SHOP_ITEMS.filter((item) => carries(item) > 0).map((item) => (
                <Row
                  key={item}
                  title={`Your ${item}`}
                  detail={`He will give you ${resalePrice(item)} back for it.`}
                  action="Sell"
                  disabled={false}
                  onAction={() => onCommand({ kind: "sell", item })}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  title,
  detail,
  action,
  disabled,
  onAction,
}: {
  title: string;
  detail: string;
  action: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="ui-sans text-sm" style={{ color: UI.parchment }}>
          {title}
        </div>
        <div className="ui-sans text-xs" style={{ color: UI.inkSoft }}>
          {detail}
        </div>
      </div>
      <button type="button" className="overlay-action shrink-0" onClick={onAction} disabled={disabled}>
        {action}
      </button>
    </div>
  );
}
