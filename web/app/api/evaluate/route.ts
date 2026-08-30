import { NextRequest, NextResponse } from "next/server";
import { loadPositions, loadTrades, loadHistory, saveAll } from "@/lib/store";
import { runEvaluation, type Position, type Trade, type Analysis } from "@/lib/evaluate";
import { sendEmails } from "@/lib/mailer";

// Bybit/Binance geo-block US datacenter IPs (403/451). This must run from a
// non-US region -- see also the project-level "regions" in vercel.json.
export const preferredRegion = "gru1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const query = req.nextUrl.searchParams.get("secret");
  return query === secret;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [positions, trades, history] = await Promise.all([
    loadPositions<Record<string, Position>>(),
    loadTrades<Trade>(),
    loadHistory<Analysis>(),
  ]);

  const result = await runEvaluation(positions, trades, history);

  await saveAll({
    positions: result.positions,
    trades: result.trades,
    history: result.history,
    latest: result.latest,
  });

  await sendEmails(result.pendingEmails);

  return NextResponse.json({
    generated_at: result.latest.generated_at,
    pending_emails_sent: result.pendingEmails.length,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
