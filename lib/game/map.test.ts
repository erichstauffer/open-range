import { describe, expect, it } from "vitest";
import { UI } from "../art/palette";
import { generateWorld } from "../world/gen";
import { REGION_LABEL_FRACTION, currentTownName, mapMarkers, mapView, paintMap } from "./map";
import { enterTown } from "./town-transition";
import { TILE_SIZE, createGameState } from "./state";

const W = 96;
const H = 96;

function freshState(seed = "map") {
  return createGameState(generateWorld(seed, W, H));
}

/** The RGB the map paints unexplored ground, read off the same constant the UI uses. */
const NIGHT = [
  Number.parseInt(UI.night.slice(1, 3), 16),
  Number.parseInt(UI.night.slice(3, 5), 16),
  Number.parseInt(UI.night.slice(5, 7), 16),
];

function pixelAt(pixels: Uint8ClampedArray, tile: number): number[] {
  return [pixels[tile * 4], pixels[tile * 4 + 1], pixels[tile * 4 + 2]];
}

describe("mapView", () => {
  it("describes the island the player is standing on", () => {
    const state = freshState();
    const view = mapView(state);
    expect(view.world).toBe(state.world);
    expect(view.visited).toBe(state.visited);
    expect(view.indoors).toBe(false);
    expect(view.playerX).toBe(state.x);
  });

  it("still describes the island from inside a town", () => {
    const state = freshState();
    const town = state.world.towns[0];
    expect(town).toBeDefined();

    const island = state.world;
    const wasX = state.x;
    enterTown(state, town);
    expect(state.world).not.toBe(island);

    const view = mapView(state);
    expect(view.world).toBe(island);
    expect(view.indoors).toBe(true);
    // The marker sits where the player was standing when they went in, which is
    // the gate of the town they are inside - not their position on the street.
    expect(view.playerX).toBe(wasX);
  });
});

describe("paintMap", () => {
  it("paints unexplored ground as night and explored ground as terrain", () => {
    const state = freshState();
    const tile = state.world.startTile;

    expect(pixelAt(paintMap(mapView(state)), tile)).toEqual(NIGHT);

    state.visited[tile] = 1;
    const seen = pixelAt(paintMap(mapView(state)), tile);
    expect(seen).not.toEqual(NIGHT);
    expect(paintMap(mapView(state))).toHaveLength(W * H * 4);
  });

  it("is fully opaque, so nothing behind the map shows through", () => {
    const state = freshState();
    const pixels = paintMap(mapView(state));
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });
});

describe("mapMarkers", () => {
  it("hides a town until its tile has been seen, then names it", () => {
    const state = freshState();
    const town = state.world.towns[0];
    state.visited.fill(0);

    expect(mapMarkers(state).towns).toHaveLength(0);

    state.visited[town.tile] = 1;
    const [marker] = mapMarkers(state).towns;
    expect(marker.id).toBe(town.id);
    expect(marker.name).toBe(town.name);
    expect(Math.floor(marker.x)).toBe(town.tile % state.world.width);
  });

  it("shows the robot even where nothing has been explored", () => {
    const state = freshState();
    state.visited.fill(0);

    const { robot } = mapMarkers(state);
    expect(robot.x).toBeCloseTo(state.robot.x / TILE_SIZE);
    expect(robot.y).toBeCloseTo(state.robot.y / TILE_SIZE);
  });

  it("omits region names unless asked, and until the region is explored", () => {
    const state = freshState();
    state.visited.fill(0);

    expect(mapMarkers(state).regions).toHaveLength(0);
    expect(mapMarkers(state, { regions: true }).regions).toHaveLength(0);

    const region = state.world.regions[0];
    const needed = Math.ceil(region.tiles.length * REGION_LABEL_FRACTION);

    // One tile short of the threshold is still an unnamed region.
    for (let i = 0; i < needed - 1; i += 1) state.visited[region.tiles[i]] = 1;
    expect(mapMarkers(state, { regions: true }).regions).toHaveLength(0);

    state.visited[region.tiles[needed - 1]] = 1;
    const [named] = mapMarkers(state, { regions: true }).regions;
    expect(named.id).toBe(region.id);
    expect(named.name).toBe(region.name);
    expect(named.x).toBe(region.centroid.x);
  });
});

describe("currentTownName", () => {
  it("is null outdoors and the town's name inside one", () => {
    const state = freshState();
    expect(currentTownName(state)).toBeNull();

    const town = state.world.towns[0];
    enterTown(state, town);
    expect(currentTownName(state)).toBe(town.name);
  });
});
