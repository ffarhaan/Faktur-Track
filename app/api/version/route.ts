export const dynamic = "force-static";

const BUILD_VERSION = String(Date.now());

export function GET() {
  return new Response(JSON.stringify({ version: BUILD_VERSION }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
