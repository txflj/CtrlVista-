import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from '../components.jsx';
import { numberText } from './model.js';

const colors = ['var(--chart-series-1, #8db7ff)', 'var(--chart-series-2, #c3a5ef)', 'var(--chart-series-3, #5ec9bc)', 'var(--chart-series-4, #e8bb78)'];
const dashes = ['', '7 4', '3 3', '10 3 2 3'];
const colorOf = (entry, index) => colors[(entry.styleIndex ?? index) % colors.length];
const dashOf = (entry, index) => dashes[(entry.styleIndex ?? index) % dashes.length];
function interpolate(times, values, target) {
  if (!times?.length) return null;
  if (target <= times[0]) return values[0];
  if (target >= times.at(-1)) return values.at(-1);
  let lo = 0, hi = times.length - 1;
  while (lo + 1 < hi) { const middle = (lo + hi) >> 1; if (times[middle] <= target) lo = middle; else hi = middle; }
  const ratio = (target - times[lo]) / (times[hi] - times[lo] || 1);
  return values[lo] + ratio * (values[hi] - values[lo]);
}
export default function ResponseChart({ entries, quantity = 'y', unit = '' }) {
  const container = useRef(null);
  const [plotSize, setPlotSize] = useState({ width: 700, height: 290 });
  const [cursor, setCursor] = useState(null);
  const data = entries.filter(item => item.run?.curves?.t?.length && item.run.curves[quantity]?.length);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(records => {
      const { width, height } = records[0].contentRect;
      if (width > 0 && height > 0) setPlotSize({ width: Math.max(260, width), height: Math.max(160, height) });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const { width, height } = plotSize;
  const left = 61, right = 22, top = 25, bottom = height - 40;
  const range = useMemo(() => {
    let min = 0, max = 0, end = 1;
    for (const entry of data) {
      end = Math.max(end, entry.run.curves.t.at(-1));
      for (const n of entry.run.curves[quantity]) if (Number.isFinite(n)) { min = Math.min(min, n); max = Math.max(max, n); }
      if (quantity === 'y') for (const n of entry.run.curves.r) if (Number.isFinite(n)) { min = Math.min(min, n); max = Math.max(max, n); }
    }
    const padding = Math.max((max - min) * 0.12, 0.05);
    return { min: min - padding, max: max + padding, end };
  }, [entries, quantity]);
  const x = time => left + time / range.end * (width - left - right);
  const y = value => bottom - (value - range.min) / (range.max - range.min) * (bottom - top);
  function path(times, values) {
    return times.map((time, index) => `${index ? 'L' : 'M'}${x(time).toFixed(2)},${y(values[index]).toFixed(2)}`).join(' ');
  }
  function point(event) { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * width; setCursor(Math.max(0, Math.min(range.end, (px - left) / (width - left - right) * range.end))); }
  const label = quantity === 'y' ? '系统输出' : quantity === 'e' ? '跟踪误差' : '控制作用';
  const ticks = width < 450 ? 4 : 6;
  const selectedTime = cursor == null ? range.end : Math.min(cursor, range.end);
  return <div className="response-chart">
    <div className="chart-plot" ref={container}>
    {!data.length ? <Empty title="尚无可绘制结果">运行仿真后，真实输出、误差与控制作用将在这里展示。</Empty> :
      <svg viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} aria-label={`${label}随时间变化。${data.length}条方案曲线。左右方向键移动游标。`} onPointerMove={point} onPointerDown={point} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setCursor(event.key === 'Home' ? 0 : event.key === 'End' ? range.end : Math.max(0, Math.min(range.end, selectedTime + (event.key === 'ArrowRight' ? 1 : -1) * range.end / 100))); }}>
        <title>{label}与方案比较</title>
        <defs><clipPath id={`plot-clip-${quantity}`}><rect x={left} y={top} width={width - left - right} height={bottom - top} /></clipPath></defs>
        <text x={left} y={15} className="axis-label">{label}{unit ? ` / ${unit}` : ''}</text>
        {Array.from({ length: 5 }, (_, index) => {
          const value = range.min + (range.max - range.min) * index / 4;
          return <g key={`y${index}`}><line x1={left} y1={y(value)} x2={width - right} y2={y(value)} className="grid-line" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{numberText(value, 2)}</text></g>;
        })}
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const time = range.end * index / ticks;
          return <g key={`x${index}`}><line x1={x(time)} x2={x(time)} y1={top} y2={bottom} className="grid-line" /><text x={x(time)} y={bottom + 21} textAnchor={index === 0 ? 'start' : index === ticks ? 'end' : 'middle'}>{numberText(time, 2)}</text></g>;
        })}
        <text x={width - right} y={height - 3} textAnchor="end" className="axis-label">时间 / s</text>
        <g clipPath={`url(#plot-clip-${quantity})`}>
          {quantity === 'y' && <path d={path(data[0].run.curves.t, data[0].run.curves.r)} className="reference-line" />}
          {data.map((entry, index) => <path key={entry.key} data-run-id={entry.run.id} data-series-index={entry.styleIndex ?? index} d={path(entry.run.curves.t, entry.run.curves[quantity])} fill="none" stroke={colorOf(entry, index)} strokeWidth={2} strokeDasharray={dashOf(entry, index)} />)}
          {cursor != null && <line x1={x(selectedTime)} x2={x(selectedTime)} y1={top} y2={bottom} className="cursor-line" />}
          {cursor != null && data.map((entry, index) => <circle key={entry.key} data-series-index={entry.styleIndex ?? index} cx={x(selectedTime)} cy={y(interpolate(entry.run.curves.t, entry.run.curves[quantity], selectedTime))} r={4} fill={colorOf(entry, index)} />)}
        </g>
      </svg>}
    </div>
    {data.length > 0 && <>
      <div className="chart-readout"><span>时刻 <strong>{numberText(selectedTime)} s</strong></span>{data.map((entry, index) => <span key={entry.key}><i style={{ width: 16, height: 0, borderRadius: 0, borderTop: `2px ${(entry.styleIndex ?? index) === 0 ? 'solid' : (entry.styleIndex ?? index) === 2 ? 'dotted' : 'dashed'} ${colorOf(entry, index)}` }} />{entry.label} <strong>{numberText(interpolate(entry.run.curves.t, entry.run.curves[quantity], selectedTime), 5)}</strong></span>)}{quantity === 'y' && <span>目标 <strong>{numberText(interpolate(data[0].run.curves.t, data[0].run.curves.r, selectedTime))}</strong></span>}</div>
    </>}
  </div>;
}
