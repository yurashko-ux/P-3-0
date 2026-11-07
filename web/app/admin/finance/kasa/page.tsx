import { redirect } from "next/navigation";

/** Касовки тепер у спільному розділі Каса: плитки, рухи й касовки по днях. */
export default function FinanceKasaPage() {
  redirect("/admin/finance/cash");
}
