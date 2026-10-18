import { getTiDBClient } from "@/lib/tidb";

export const dynamic = "force-dynamic";

interface FakturPayload {
  invoice_key: string;
  no_faktur: string;
  no_sales_order?: string;
  customer_name?: string;
  order_date?: string;
  transaction_date?: string;
  jenis_transaksi?: string;
  kategori?: string;
  kategori_produk?: string;
  status_cetak?: boolean;
  printed_at?: string | null;
  printed_by?: string | null;
  total_harga?: number;
  items?: unknown[];
}

export async function GET() {
  try {
    const conn = getTiDBClient();
    const result = (await conn.execute("SELECT COUNT(*) as count FROM fakturs_archive;")) as Array<{ count: number }>;
    return Response.json({
      success: true,
      totalArchived: result[0]?.count || 0,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;
    const conn = getTiDBClient();

    if (action === "upsert_batch") {
      const fakturs: FakturPayload[] = body.fakturs || [];
      if (fakturs.length === 0) {
        return Response.json({ success: true, count: 0 });
      }

      // Batch in slices of 100 to keep queries fast and light
      const CHUNK_SIZE = 100;
      for (let i = 0; i < fakturs.length; i += CHUNK_SIZE) {
        const slice = fakturs.slice(i, i + CHUNK_SIZE);

        for (const item of slice) {
          const invKey = String(item.invoice_key || "").trim();
          if (!invKey) continue;

          const noFaktur = String(item.no_faktur || invKey).trim();
          const noSO = String(item.no_sales_order || "-").trim();
          const cust = String(item.customer_name || "-").trim();
          const oDate = String(item.order_date || "-").trim();
          const txDate = String(item.transaction_date || item.order_date || "-").trim();
          const jenis = String(item.jenis_transaksi || "DOO").trim();
          const kat = String(item.kategori || "3P").trim();
          const katProd = String(item.kategori_produk || "FARMA").trim();
          const isPrinted = item.status_cetak ? 1 : 0;
          const pAt = item.printed_at || null;
          const pBy = item.printed_by || null;
          const totalHarga = Number(item.total_harga || 0);
          const itemsJson = item.items ? JSON.stringify(item.items) : null;

          // Non-destructive Smart Upsert upholding LOCKED_RULES.md
          await conn.execute(
            `INSERT INTO fakturs_archive (
              invoice_key, no_faktur, no_sales_order, customer_name,
              order_date, transaction_date, jenis_transaksi, kategori,
              kategori_produk, status_cetak, printed_at, printed_by,
              total_harga, items_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              no_sales_order = IF(VALUES(no_sales_order) IS NOT NULL AND CHAR_LENGTH(VALUES(no_sales_order)) > 1, VALUES(no_sales_order), fakturs_archive.no_sales_order),
              customer_name = IF(VALUES(customer_name) IS NOT NULL AND CHAR_LENGTH(VALUES(customer_name)) > 1, VALUES(customer_name), fakturs_archive.customer_name),
              transaction_date = IF(VALUES(transaction_date) IS NOT NULL AND CHAR_LENGTH(VALUES(transaction_date)) > 1, VALUES(transaction_date), fakturs_archive.transaction_date),
              kategori = VALUES(kategori),
              kategori_produk = VALUES(kategori_produk),
              status_cetak = IF(fakturs_archive.status_cetak = 1, 1, VALUES(status_cetak)),
              printed_at = IF(fakturs_archive.status_cetak = 1, fakturs_archive.printed_at, VALUES(printed_at)),
              printed_by = IF(fakturs_archive.status_cetak = 1, fakturs_archive.printed_by, VALUES(printed_by)),
              total_harga = VALUES(total_harga),
              items_json = IF(VALUES(items_json) IS NOT NULL, VALUES(items_json), fakturs_archive.items_json);`,
            [
              invKey,
              noFaktur,
              noSO,
              cust,
              oDate,
              txDate,
              jenis,
              kat,
              katProd,
              isPrinted,
              pAt,
              pBy,
              totalHarga,
              itemsJson,
            ]
          );
        }
      }

      return Response.json({ success: true, processed: fakturs.length });
    }

    if (action === "update_print") {
      const keys: string[] = body.keys || [];
      const isPrinted = body.isPrinted ? 1 : 0;
      const printedAt = body.printedAt || null;
      const printedBy = body.printedBy || null;

      for (const k of keys) {
        await conn.execute(
          "UPDATE fakturs_archive SET status_cetak = ?, printed_at = ?, printed_by = ? WHERE invoice_key = ?;",
          [isPrinted, printedAt, printedBy, k]
        );
      }

      return Response.json({ success: true, updated: keys.length });
    }

    return Response.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("TiDB API Error (non-blocking):", message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
