import Nav from "@/components/Nav";
import LiveBoundary from "@/components/LiveBoundary";

export const metadata = {
  title: "Live — Agenthesis",
};

export default function LivePage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <LiveBoundary />
    </main>
  );
}
