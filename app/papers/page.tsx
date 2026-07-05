import { redirect } from "next/navigation";

// The papers catalog was the mechanic of the old forecaster-agent product. This oracle is a
// measurement, not a strategy menu, so /papers is retired and points at the real evidence.
export default function PapersPage() {
  redirect("/proof");
}
