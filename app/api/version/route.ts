export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const version = process.env.NEXT_PUBLIC_BUILD_TIME || "dev";
  return new Response(JSON.stringify({ version, timestamp: Date.now() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

