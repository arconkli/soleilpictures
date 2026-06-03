// CloudflareAnalyticsLink — a banner pointing to the Cloudflare Web Analytics
// dashboard, which covers what the first-party funnel can't (anonymous-visit
// attribution, referrers, top pages, Web Vitals). Extracted from the old
// AdminAnalyticsTab.

export function CloudflareAnalyticsLink() {
  const cwaUrl = 'https://dash.cloudflare.com/?to=/:account/web-analytics';
  const tokenSet = !!import.meta.env.VITE_CF_ANALYTICS_TOKEN;
  return (
    <section className="admin-chart-panel admin-chart-panel-wide admin-cwa-link">
      <div className="admin-cwa-row">
        <div>
          <div className="admin-stat-label">Marketing analytics</div>
          <div className="admin-cwa-title">Cloudflare Web Analytics</div>
          <div className="admin-cwa-sub t-meta">
            Anonymous visits, referrers, top pages, country breakdown, and Web Vitals
            — covers what the first-party funnel can't (anon-visit attribution).
            {!tokenSet && ' Beacon not wired — set VITE_CF_ANALYTICS_TOKEN.'}
          </div>
        </div>
        <a className="admin-action admin-action-primary" href={cwaUrl} target="_blank" rel="noreferrer">
          Open Cloudflare ↗
        </a>
      </div>
    </section>
  );
}
