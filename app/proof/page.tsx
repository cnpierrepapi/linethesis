import Nav from "@/components/Nav";
import ProofBoard from "@/components/ProofBoard";

export const metadata = {
  title: "Proof & Evidence — Agenthesis",
};

export default function ProofPage() {
  return (
    <main className="min-h-screen">
      <Nav />
      <ProofBoard />
    </main>
  );
}
