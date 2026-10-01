export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUILD_VERSION = String(Date.now());

export function GET() {
  return new Response(JSON.stringify({ version: BUILD_VERSION }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
