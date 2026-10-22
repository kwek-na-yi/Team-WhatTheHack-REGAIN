// Chart colours drawn from the design tokens (Recharts needs raw values).
// Each colour has one job: plum = the series that matters, muted blue = comparison,
// crimson = negative / at risk, green = positive, grey = background categories.
export const CHART = {
  primary: "#806587", // the series that matters
  primaryStrong: "#38263C", // highlighted mark / reference
  compare: "#52657B", // comparison series (e.g. customers who did not receive the action)
  neutral: "#C9C1CD", // other categories
  faint: "#E5DFE8", // ineligible / de-emphasised
  risk: "#C83F52",
  good: "#287A55",
  grid: "#EEEAF0",
  axis: "#716778",
  ref: "#B9AFBD",
  whisker: "#211A25",
  cursor: "rgba(56, 38, 60, 0.05)",
  label: "#3F3545",
};
export const AXIS = { fontSize: 12, fill: CHART.axis };
export const tooltipBox = "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-md";
/** Props for Recharts' default <Tooltip> so it matches the theme. */
export const tooltipProps = {
  contentStyle: { background: "#FFFFFF", border: "1px solid #E5DFE8", borderRadius: 6, color: "#211A25", fontSize: 12, boxShadow: "0 4px 12px rgba(33,26,37,0.08)" },
  labelStyle: { color: "#716778" },
  itemStyle: { color: "#211A25" },
  cursor: { fill: CHART.cursor },
};
