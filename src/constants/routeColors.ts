export const ROUTE_COLORS = ['#ff1744', '#00b0ff', '#00e676', '#ff9100', '#d500f9', '#ffd600', '#00e5ff', '#76ff03', '#ff4081'] as const;

export type RouteColor = (typeof ROUTE_COLORS)[number];
