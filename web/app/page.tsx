import { loadLatest, loadTrades } from "@/lib/store";
import type { Analysis, LatestSnapshot, Position, Trade } from "@/lib/evaluate";

export const dynamic = "force-dynamic";

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.round(mins / 60)} h`;
}

function Checklist({ title, checks }: { title: string; checks: Record<string, boolean> }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="checks">
        {Object.entries(checks || {}).map(([label, ok]) => (
          <li key={label} className={ok ? "ok" : "no"}>
            <span className={`icon ${ok ? "ok" : "no"}`}>{ok ? "✓" : "✕"}</span>
            <span className="label">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function Page() {
  const [latest, trades] = await Promise.all([
    loadLatest<LatestSnapshot>(),
    loadTrades<Trade>(),
  ]);

  const symbols: [string, Analysis][] = latest ? Object.entries(latest.symbols) : [];
  const openPositions: Position[] = latest ? Object.values(latest.open_positions ?? {}) : [];

  let wins = 0;
  let totalPnl = 0;
  for (const t of trades) {
    if (t.outcome === "TP") wins++;
    totalPnl += t.pnl_pct;
  }
  const total = trades.length;
  const winRate = total ? ((100 * wins) / total).toFixed(1) : "—";
  const tradesDesc = [...trades].reverse();

  return (
    <div className="wrap">
      <header>
        <h1>Kramm Bybit Monitor</h1>
        <div className="updated">
          {latest ? `Última actualización: ${timeAgo(latest.generated_at)}` : "Sin datos todavía — esperando la primera corrida."}
        </div>
      </header>
      <div className="disclaimer">
        Monitoreo automático (perpetuos USD-M de Bybit, evaluación cada 1h) sobre BTC, ETH y BNB.
        Ninguna combinación de indicadores garantiza retorno — esto maximiza probabilidad, no certeza.
        Las operaciones mostradas son <strong>simuladas</strong> (paper trading), sin ejecución real.
      </div>

      <div className="price-row">
        {symbols.map(([sym, s]) => (
          <div className="price-card" key={sym}>
            <div className="sym">{sym}</div>
            <div className="val">${fmt(s.price, s.price < 10 ? 4 : 2)}</div>
            <div className="rsi">
              RSI {fmt(s.rsi, 1)} · funding {fmt(s.funding_rate * 100, 3)}%
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2>Indicadores por símbolo</h2>
        <div>
          {symbols.map(([sym, s]) => {
            const badge = s.long_signal ? (
              <span className="badge long">LONG confirmado</span>
            ) : s.short_signal ? (
              <span className="badge short">SHORT confirmado</span>
            ) : (
              <span className="badge none">sin señal</span>
            );
            return (
              <div className="symbol-block" key={sym}>
                <h2>
                  {sym} {badge}
                </h2>
                <div className="checklists">
                  <Checklist title="Checklist LONG" checks={s.long_checks} />
                  <Checklist title="Checklist SHORT" checks={s.short_checks} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2>Posiciones simuladas abiertas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Dirección</th>
                <th>Entrada</th>
                <th>SL</th>
                <th>TP</th>
                <th>Abierta</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((p) => (
                <tr key={p.symbol}>
                  <td>{p.symbol}</td>
                  <td>{p.direction}</td>
                  <td>{fmt(p.entry, 4)}</td>
                  <td>{fmt(p.sl, 4)}</td>
                  <td>{fmt(p.tp, 4)}</td>
                  <td>{timeAgo(p.opened_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!openPositions.length && <div className="empty">No hay posiciones simuladas abiertas.</div>}
        </div>
      </section>

      <section>
        <h2>Historial de operaciones simuladas</h2>
        <div className="stats-row">
          <div className="stat">
            <div className="n">{total}</div>
            <div className="l">operaciones cerradas</div>
          </div>
          <div className="stat">
            <div className="n">
              {winRate}
              {total ? "%" : ""}
            </div>
            <div className="l">win rate</div>
          </div>
          <div className="stat">
            <div className="n">{total ? `${fmt(totalPnl, 2)}%` : "—"}</div>
            <div className="l">PnL acumulado</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Símbolo</th>
                <th>Dirección</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Resultado</th>
                <th>PnL %</th>
                <th>Cerrada</th>
              </tr>
            </thead>
            <tbody>
              {tradesDesc.map((t, i) => (
                <tr key={`${t.symbol}-${t.exit_time}-${i}`}>
                  <td>{t.symbol}</td>
                  <td>{t.direction}</td>
                  <td>{fmt(t.entry, 4)}</td>
                  <td>{fmt(t.exit, 4)}</td>
                  <td>{t.outcome}</td>
                  <td className={t.pnl_pct >= 0 ? "pos" : "neg"}>{fmt(t.pnl_pct, 2)}%</td>
                  <td>{timeAgo(t.exit_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tradesDesc.length && (
            <div className="empty">Todavía no se cerró ninguna operación simulada.</div>
          )}
        </div>
      </section>
    </div>
  );
}
