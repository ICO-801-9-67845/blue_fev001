import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getActiveUsersRequest,
  getAnalyticsSummaryRequest,
  getAnalyticsTrendsRequest,
  getRecentSessionsRequest,
} from "../api/adminAnalyticsApi";
import { useAuth } from "../hooks/useAuth";

const RANGE_OPTIONS = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX").format(value || 0);
}

function formatDateTime(value) {
  if (!value) return "Sin registro";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min`;
  return `${seconds} s`;
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function TrendBars({ data, valueKey, label, formatter = formatNumber, summaryValue }) {
  const maxValue = Math.max(1, ...data.map((item) => item[valueKey] || 0));
  const firstDate = data[0]?.date;
  const lastDate = data[data.length - 1]?.date;

  return (
    <section className="trend-series" aria-label={label}>
      <div className="trend-series-heading">
        <h3>{label}</h3>
        <strong>{formatter(summaryValue ?? data.reduce((sum, item) => sum + (item[valueKey] || 0), 0))}</strong>
      </div>
      <div className="trend-bars" role="img" aria-label={`Grafica de ${label.toLowerCase()}`}>
        {data.map((item) => {
          const value = item[valueKey] || 0;
          const height = value ? Math.max(6, (value / maxValue) * 100) : 0;
          return (
            <span className="trend-bar-track" key={item.date} title={`${item.date}: ${formatter(value)}`}>
              <span className="trend-bar" style={{ height: `${height}%` }} />
            </span>
          );
        })}
      </div>
      <div className="trend-axis"><span>{firstDate}</span><span>{lastDate}</span></div>
    </section>
  );
}

function StatusView({ title, message, action }) {
  return (
    <main className="admin-state-page">
      <div className="admin-state-content">
        <span className="admin-brand-mark">Blue FEV</span>
        <h1>{title}</h1>
        <p>{message}</p>
        {action}
      </div>
    </main>
  );
}

export default function AdminAnalyticsPage() {
  const [summary, setSummary] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [trends, setTrends] = useState([]);
  const [recent, setRecent] = useState({ data: [], pagination: null });
  const [range, setRange] = useState("30d");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", userId: "" });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [accessState, setAccessState] = useState("");
  const [error, setError] = useState("");
  const [activeError, setActiveError] = useState("");
  const [lastActiveRefresh, setLastActiveRefresh] = useState(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const metricCards = useMemo(() => summary ? [
    ["Activos ahora", formatNumber(summary.activeUsersNow), "Heartbeat en los ultimos 90 segundos"],
    ["Usuarios registrados", formatNumber(summary.totalRegisteredUsers), `${formatNumber(summary.returningUsers)} recurrentes`],
    ["Nuevos hoy", formatNumber(summary.newUsersToday), `${formatNumber(summary.newUsersThisWeek)} esta semana`],
    ["Sesiones hoy", formatNumber(summary.sessionsToday), `${formatNumber(summary.totalSessions)} historicas`],
    ["Duracion promedio", formatDuration(summary.averageSessionDurationSeconds), `Mediana: ${formatDuration(summary.medianSessionDurationSeconds)}`],
    ["Conversaciones", formatNumber(summary.totalConversations), "Totales"],
    ["Mensajes", formatNumber(summary.totalMessages), `${formatNumber(summary.totalUserMessages)} enviados por usuarios`],
    ["Concurrencia maxima", formatNumber(summary.peakConcurrentUsersToday), "Usuarios simultaneos hoy"],
  ] : [], [summary]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [summaryData, activeData, trendsData, recentData] = await Promise.all([
          getAnalyticsSummaryRequest(),
          getActiveUsersRequest(),
          getAnalyticsTrendsRequest(range),
          getRecentSessionsRequest({ page: 1, limit: 20 }),
        ]);
        if (cancelled) return;
        setSummary(summaryData);
        setActiveUsers(activeData);
        setTrends(trendsData.data);
        setRecent(recentData);
        setLastActiveRefresh(new Date());
      } catch (requestError) {
        if (cancelled) return;
        const status = requestError.response?.status;
        if (status === 403) setAccessState("denied");
        else if (status === 401) setAccessState("expired");
        else setError(requestError.response?.data?.message || "No fue posible cargar las analiticas");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || accessState) return undefined;
    let cancelled = false;
    getAnalyticsTrendsRequest(range)
      .then((result) => { if (!cancelled) setTrends(result.data); })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.response?.data?.message || "No fue posible actualizar las tendencias");
      });
    return () => { cancelled = true; };
  }, [range, loading, accessState]);

  useEffect(() => {
    if (loading || accessState) return undefined;
    let cancelled = false;
    getRecentSessionsRequest({ page, limit: 20, ...appliedFilters })
      .then((result) => { if (!cancelled) setRecent(result); })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.response?.data?.message || "No fue posible actualizar las sesiones");
      });
    return () => { cancelled = true; };
  }, [page, appliedFilters, loading, accessState]);

  useEffect(() => {
    if (loading || accessState) return undefined;
    const refresh = async () => {
      try {
        const data = await getActiveUsersRequest();
        setActiveUsers(data);
        setLastActiveRefresh(new Date());
        setActiveError("");
      } catch (requestError) {
        setActiveError(requestError.response?.data?.message || "No fue posible actualizar usuarios activos");
      }
    };
    const intervalId = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(intervalId);
  }, [loading, accessState]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  if (loading) {
    return <StatusView title="Cargando analiticas" message="Estamos preparando las metricas de uso de Blue." />;
  }

  if (accessState === "denied") {
    return <StatusView title="Acceso denegado" message="Tu cuenta no tiene permisos para consultar este panel." action={<Link className="admin-primary-link" to="/chat">Volver al chat</Link>} />;
  }

  if (accessState === "expired") {
    return <StatusView title="Sesion expirada" message="Inicia sesion de nuevo para continuar." action={<Link className="admin-primary-link" to="/login">Iniciar sesion</Link>} />;
  }

  if (error && !summary) {
    return <StatusView title="Error de red" message={error} action={<button className="admin-primary-link" type="button" onClick={() => window.location.reload()}>Reintentar</button>} />;
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="admin-brand-mark">Blue FEV</span>
          <p className="eyebrow">Administracion</p>
          <h1>Analiticas de uso</h1>
          <p>Actividad, sesiones y crecimiento del chatbot en un solo lugar.</p>
        </div>
        <div className="admin-header-actions">
          <div className="admin-user-identity"><strong>{user?.name}</strong><span>{user?.email}</span></div>
          <Link className="admin-secondary-link" to="/chat">Ir al chat</Link>
          <button className="admin-signout" type="button" onClick={handleLogout}>Salir</button>
        </div>
      </header>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <section className="admin-section" aria-labelledby="summary-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">Panorama</p><h2 id="summary-title">Resumen general</h2></div>
          <div className="activity-window"><span>DAU {summary.dailyActiveUsers}</span><span>WAU {summary.weeklyActiveUsers}</span><span>MAU {summary.monthlyActiveUsers}</span></div>
        </div>
        <div className="admin-metric-grid">
          {metricCards.map(([label, value, detail]) => <MetricCard key={label} label={label} value={value} detail={detail} />)}
        </div>
      </section>

      <section className="admin-section" aria-labelledby="active-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">Presencia</p><h2 id="active-title">Usuarios activos</h2></div>
          <span className="admin-refresh-note">Actualizacion cada 15 s{lastActiveRefresh ? ` | ${lastActiveRefresh.toLocaleTimeString("es-MX")}` : ""}</span>
        </div>
        {activeError ? <div className="admin-inline-error" role="alert">{activeError}</div> : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Usuario</th><th>Correo</th><th>Inicio de sesion</th><th>Ultima actividad</th><th>Tiempo activo</th></tr></thead>
            <tbody>
              {activeUsers.length ? activeUsers.map((activeUser) => (
                <tr key={activeUser.userId}>
                  <td><strong>{activeUser.name}</strong></td>
                  <td>{activeUser.email}</td>
                  <td>{formatDateTime(activeUser.sessionStartedAt)}</td>
                  <td>{formatDateTime(activeUser.lastSeenAt)}</td>
                  <td>{formatDuration(activeUser.currentDurationSeconds)}</td>
                </tr>
              )) : <tr><td colSpan="5" className="admin-empty-cell">No hay usuarios activos ahora.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section" aria-labelledby="trends-title">
        <div className="admin-section-heading">
          <div><p className="eyebrow">Evolucion</p><h2 id="trends-title">Tendencias</h2></div>
          <div className="admin-segmented" aria-label="Rango de tendencias">
            {RANGE_OPTIONS.map((option) => (
              <button type="button" key={option.value} className={range === option.value ? "active" : ""} onClick={() => setRange(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="trend-grid">
          <TrendBars data={trends} valueKey="activeUsers" label="Usuarios activos" />
          <TrendBars data={trends} valueKey="newUsers" label="Nuevos registros" />
          <TrendBars data={trends} valueKey="sessions" label="Sesiones" />
          <TrendBars data={trends} valueKey="averageSessionDurationSeconds" label="Duracion promedio" formatter={formatDuration} summaryValue={summary.averageSessionDurationSeconds} />
          <TrendBars data={trends} valueKey="conversations" label="Conversaciones" />
          <TrendBars data={trends} valueKey="messages" label="Mensajes" />
        </div>
      </section>

      <section className="admin-section" aria-labelledby="recent-title">
        <div className="admin-section-heading"><div><p className="eyebrow">Detalle</p><h2 id="recent-title">Sesiones recientes</h2></div></div>
        <form className="admin-filters" onSubmit={applyFilters}>
          <label>Desde<input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label>Hasta<input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
          <label>ID de usuario<input type="text" value={filters.userId} onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))} placeholder="Opcional" /></label>
          <button type="submit">Aplicar filtros</button>
        </form>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Usuario</th><th>Inicio</th><th>Ultima actividad</th><th>Fin</th><th>Duracion</th><th>Mensajes</th><th>Estado</th></tr></thead>
            <tbody>
              {recent.data.length ? recent.data.map((session) => (
                <tr key={session.id}>
                  <td><strong>{session.name}</strong><small>{session.email}</small></td>
                  <td>{formatDateTime(session.startedAt)}</td>
                  <td>{formatDateTime(session.lastSeenAt)}</td>
                  <td>{formatDateTime(session.endedAt)}</td>
                  <td>{formatDuration(session.durationSeconds)}</td>
                  <td>{formatNumber(session.messageCount)}</td>
                  <td><span className={`session-status ${session.status === "Activa" ? "active" : "ended"}`}>{session.status}</span></td>
                </tr>
              )) : <tr><td colSpan="7" className="admin-empty-cell">No hay sesiones para estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="admin-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button>
          <span>Pagina {recent.pagination?.page || 1} de {recent.pagination?.totalPages || 1}</span>
          <button type="button" disabled={page >= (recent.pagination?.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>Siguiente</button>
        </div>
      </section>
    </main>
  );
}
