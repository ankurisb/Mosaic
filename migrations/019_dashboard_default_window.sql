-- 019_dashboard_default_window.sql
-- Per-dashboard default time window, so a dashboard built from the chat builder
-- opens on a window that actually covers its data (detected during the dry-run)
-- instead of always defaulting to "Today" and looking blank over historical data.
-- Value is a time-window token understood by the panel executor + DashboardView
-- (e.g. 'today', '7d', '30d', '90d', '1y', 'all'); NULL falls back to 'today'.
ALTER TABLE dashboards ADD COLUMN default_time_window TEXT;
