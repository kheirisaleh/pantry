import type { ChartConfiguration, ChartType } from "chart.js";
import { useEffect, useRef } from "react";

export const SERIES = ["#f2a93b", "#a9cf83", "#e7a3c4", "#8fb8ea", "#ec5a6b", "#d9c27a", "#9f8fd6", "#6fc7b8"];

type ChartModule = typeof import("chart.js/auto");
let loader: Promise<ChartModule> | null = null;

export function loadCharts(): Promise<ChartModule> {
  loader ??= import("chart.js/auto").then((module) => {
    module.Chart.defaults.color = "#c9bcc9";
    module.Chart.defaults.font.family = "Manrope, system-ui, sans-serif";
    module.Chart.defaults.borderColor = "rgba(70, 55, 79, 0.6)";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) module.Chart.defaults.animation = false;
    return module;
  });
  return loader;
}

export function ChartBox<T extends ChartType>({ config, height = 240 }: { config: ChartConfiguration<T>; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const serialized = JSON.stringify(config.data) + JSON.stringify(config.type);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    let chart: { destroy: () => void } | null = null;
    let cancelled = false;
    void loadCharts().then((module) => {
      if (cancelled || !canvas.current) return;
      const current = configRef.current;
      const options: unknown = Object.assign(
        { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: current.data.datasets.length > 1, labels: { boxWidth: 12 } } } },
        current.options,
      );
      chart = new module.Chart(canvas.current, { type: current.type, data: current.data, options } as unknown as ChartConfiguration);
    });
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [serialized]);

  return (
    <div className="chart" style={{ height: String(height) + "px" }}>
      <canvas ref={canvas} role="img" aria-label="Chart" />
    </div>
  );
}
