-- 020_dashboard_grid_12col.sql
-- Dashboard panels moved from a 4-column grid to a 12-column grid so widths
-- (and the resize handle) snap in 1/12ths instead of coarse quarters. Existing
-- panels store w on the old 1–4 scale; multiply by 3 to preserve their visual
-- proportion (1→3 quarter, 2→6 half, 3→9 three-quarter, 4→12 full). Runs once.
UPDATE dashboard_panels SET w = w * 3 WHERE w BETWEEN 1 AND 4;
