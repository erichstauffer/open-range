import GameCanvas from "@/components/game-canvas";

export const metadata = {
  title: "Open Range",
};

/**
 * `searchParams` is a promise in Next 16, so this route is async. The seed
 * arrives from the URL, which is the whole sharing mechanism: `?seed=dunhollow`
 * grows the same island for everyone who opens it.
 */
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; resume?: string }>;
}) {
  const { seed, resume } = await searchParams;
  return <GameCanvas seed={seed?.trim() || "dunhollow"} resume={resume === "1"} />;
}
