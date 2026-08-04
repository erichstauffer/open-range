import AtlasInspector from "@/components/atlas-inspector";

export const metadata = {
  title: "Atlas inspector · Open Range",
};

/**
 * `AtlasInspector` is a client component that does all of its canvas work in
 * an effect and renders a plain placeholder on the server, so it needs no
 * `ssr: false` wrapper - which would not be legal from a server component
 * anyway.
 */
export default function AtlasPage() {
  return <AtlasInspector />;
}
