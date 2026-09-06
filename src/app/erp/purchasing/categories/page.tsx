import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { queryCatalog } from "@/lib/erp/actions";
import { CATALOG_PAGE } from "@/lib/erp/catalog";
import { CatalogTable } from "@/components/erp/catalog-table";
import { CategoryCards, type CategoryCard } from "@/components/erp/category-cards";
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Las categorías son dato.

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse by category — RTG ERP" };

export default async function PurchasingCategories({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // purchasing — manager/admin only (#29)
  const sp = await searchParams;
  const cat = sp?.cat || null;
  const supabase = await createClient();

  // Category detail: reuse the paginated catalog table, pre-filtered + compact (no global KPIs/tabs).
  if (cat) {
    const first = await queryCatalog({ categoryPath: cat, offset: 0, limit: CATALOG_PAGE });
    return (
      <>
        <Header />
        <main className="mx-auto max-w-screen-2xl px-4 py-6">
          <Link href="/erp/purchasing/categories" className="text-sm text-clay-600 hover:underline"><Tx en="← All categories" es="← Todas las categorías" /></Link>
          <h1 className="mt-2 text-2xl font-semibold">{cat}</h1>
          <p className="mb-4 text-sm text-slate-500">{first.total.toLocaleString()} <Tx en="products in" es="productos en" /> {cat} · <Tx en="priced with cost (manager view, #29)." es="con costo (vista de gerente, #29)." /></p>
          <CatalogTable
            initialRows={first.rows}
            initialTotal={first.total}
            pageSize={CATALOG_PAGE}
            canSeeCost={canSeeCost(session.role)}
            lockedCategory={cat}
            compact
            initialError={first.error ?? null}
          />
        </main>
      </>
    );
  }

  // Cards grid: L1 categories with count + a sample of products.
  const data = unwrap(await supabase.rpc("category_browse"), "purchasing/categories: category_browse");
  const cards = (data ?? []) as CategoryCard[];
  const ids = cards.flatMap((c) => (c.sample ?? []).map((s) => s.id));
  const imgMap: Record<number, string> = {};
  if (ids.length) {
    const imgs = unwrap(
      await supabase
        .from("product_images")
        .select("product_id,storage_path")
        .in("product_id", ids)
        .eq("sort_order", 0),
      "purchasing/categories: product_images",
    );
    for (const i of imgs ?? []) imgMap[i.product_id as number] = i.storage_path as string;
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Link href="/erp/purchasing" className="text-sm text-clay-600 hover:underline"><Tx en="← Purchasing" es="← Compras" /></Link>
        <h1 className="mt-2 text-2xl font-semibold"><Tx en="Browse by category" es="Explorar por categoría" /></h1>
        <p className="mb-4 text-sm text-slate-500">
          {cards.length} <Tx en="categories · click a card to see every product (priced with cost — manager view, #29)." es="categorías · clic en una tarjeta para ver todos los productos (con costo — vista de gerente, #29)." />
        </p>
        <CategoryCards cards={cards} imgMap={imgMap} />
      </main>
    </>
  );
}
