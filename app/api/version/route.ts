export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const buildId =
    process.env.NEXT_PUBLIC_APP_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "dev";

  return new Response(JSON.stringify({ buildId, timestamp: Date.now() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
