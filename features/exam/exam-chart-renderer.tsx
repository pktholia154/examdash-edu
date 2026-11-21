'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { VisualBlock } from '../../lib/exam/types';
import { useTheme } from '../theme/theme-provider';

const LIGHT_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];
const DARK_COLORS = [
  '#60a5fa',
  '#f87171',
  '#4ade80',
  '#fbbf24',
  '#c084fc',
  '#22d3ee',
];

type ChartVisual = Extract<VisualBlock, { type: 'chart' }>;

export function ExamChartRenderer({
  visual,
  heightClass = 'h-72',
}: {
  visual: ChartVisual;
  heightClass?: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const palette = isDark ? DARK_COLORS : LIGHT_COLORS;
  const axisStroke = isDark ? '#94a3b8' : '#475569';
  const gridStroke = isDark ? '#334155' : '#e2e8f0';
  const tooltipStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
    borderColor: isDark ? '#334155' : '#cbd5e1',
    color: isDark ? '#f8fafc' : '#0f172a',
    borderRadius: '8px',
    fontSize: '12px',
  };

  const isNumericScatterX =
    visual.chartType === 'scatter' &&
    typeof visual.data?.[0]?.[visual.xAxisKey] === 'number';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hasSize, setHasSize] = useState(
    () => typeof ResizeObserver === 'undefined'
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      setHasSize(Boolean(cr && cr.width > 0 && cr.height > 0));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`${heightClass} w-full min-w-0 tabular-nums`}
    >
      {hasSize && (
        <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
        {visual.chartType === 'pie' ? (
          <PieChart>
            <Pie
              data={visual.data}
              dataKey={visual.series?.[0]?.key || 'value'}
              nameKey={visual.xAxisKey || 'name'}
              cx="50%"
              cy="50%"
              outerRadius={82}
              isAnimationActive={false}
              label={({ name, value }) => `${name}: ${value}`}
            >
              {visual.data.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
          </PieChart>
        ) : visual.chartType === 'radar' ? (
          <RadarChart data={visual.data}>
            <PolarGrid stroke={gridStroke} />
            <PolarAngleAxis
              dataKey={visual.xAxisKey}
              tick={{ fill: axisStroke, fontSize: 11 }}
            />
            <PolarRadiusAxis tick={{ fill: axisStroke, fontSize: 10 }} />
            {(visual.series || []).map((s, i) => (
              <Radar
                key={s.key || i}
                name={s.label || s.key}
                dataKey={s.key}
                isAnimationActive={false}
                stroke={palette[i % palette.length]}
                fill={palette[i % palette.length]}
                fillOpacity={0.28}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Tooltip contentStyle={tooltipStyle} />
          </RadarChart>
        ) : (
          <ComposedChart
            data={visual.data}
            margin={{ top: 8, right: 16, bottom: 12, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey={visual.xAxisKey}
              type={isNumericScatterX ? 'number' : 'category'}
              domain={isNumericScatterX ? ['auto', 'auto'] : undefined}
              stroke={axisStroke}
              tick={{ fill: axisStroke, fontSize: 11 }}
              label={
                visual.xAxisLabel
                  ? {
                      value: visual.xAxisLabel,
                      position: 'insideBottom',
                      offset: -4,
                      fill: axisStroke,
                      fontSize: 11,
                    }
                  : undefined
              }
            />
            <YAxis
              yAxisId="left"
              orientation="left"
              stroke={axisStroke}
              tick={{ fill: axisStroke, fontSize: 11 }}
              label={
                visual.yAxisLabel
                  ? {
                      value: visual.yAxisLabel,
                      angle: -90,
                      position: 'insideLeft',
                      fill: axisStroke,
                      fontSize: 11,
                    }
                  : undefined
              }
            />
            {(visual.series || []).some((s) => s.yAxis === 'right') && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={axisStroke}
                tick={{ fill: axisStroke, fontSize: 11 }}
                label={
                  visual.rightYAxisLabel
                    ? {
                        value: visual.rightYAxisLabel,
                        angle: 90,
                        position: 'insideRight',
                        fill: axisStroke,
                        fontSize: 11,
                      }
                    : undefined
                }
              />
            )}
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {(visual.series || []).map((s, i) => {
              const yAxisId = s.yAxis || 'left';
              const color = palette[i % palette.length];
              const kind = s.type || visual.chartType;

              if (kind === 'scatter') {
                return (
                  <Scatter
                    key={s.key || i}
                    yAxisId={yAxisId}
                    name={s.label}
                    dataKey={s.key}
                    fill={color}
                    isAnimationActive={false}
                  />
                );
              }
              if (kind === 'line') {
                return (
                  <Line
                    key={s.key || i}
                    yAxisId={yAxisId}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={color}
                    strokeWidth={2.5}
                    isAnimationActive={false}
                  />
                );
              }
              if (kind === 'area') {
                return (
                  <Area
                    key={s.key || i}
                    yAxisId={yAxisId}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.25}
                    isAnimationActive={false}
                  />
                );
              }
              return (
                <Bar
                  key={s.key || i}
                  yAxisId={yAxisId}
                  dataKey={s.key}
                  name={s.label}
                  stackId={
                    visual.chartType === 'stacked_bar' ? 'stack' : undefined
                  }
                  fill={color}
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        )}
        </ResponsiveContainer>
      )}
    </div>
  );
}
