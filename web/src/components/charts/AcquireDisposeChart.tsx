'use client';

import { useMemo, useRef, useCallback } from 'react';
import type { ChartOptions, Chart as ChartJS } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatNumberCompact } from '../../lib/formatters';
import { exportChartJsAsPng } from '../../lib/chart-export';
import { ExportButton } from './ExportButton';
import { EmptyState } from '../EmptyState';
import { registerChartComponents } from '../../lib/chart-utils';

// Ensure Chart.js scales/elements are registered even when no other chart-utils
// consumer is on the page (this is the only chart on the insider page).
registerChartComponents();

interface Transaction {
  transaction_date: string;
  shares: number | null;
  acquired_disposed: string;
}

interface AcquireDisposeChartProps {
  transactions: Transaction[];
  title?: string;
}

export function AcquireDisposeChart({ transactions, title = 'Acquire vs Dispose' }: AcquireDisposeChartProps) {
  const chartRef = useRef<ChartJS<'bar'>>(null);

  const handleExport = useCallback(async () => {
    await exportChartJsAsPng(chartRef, 'acquire-dispose', undefined, title);
  }, [title]);

  const chartData = useMemo(() => {
    // Group by month
    const monthlyData = new Map<string, { acquired: number; disposed: number }>();

    transactions.forEach((tx) => {
      if (!tx.transaction_date || !tx.shares) return;

      const date = new Date(tx.transaction_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { acquired: 0, disposed: 0 });
      }

      const data = monthlyData.get(monthKey)!;
      const shares = Number(tx.shares);
      if (tx.acquired_disposed === 'A') {
        data.acquired += shares;
      } else if (tx.acquired_disposed === 'D') {
        data.disposed += shares;
      }
    });

    // Sort by month and get last 12 months
    const sortedMonths = [...monthlyData.keys()].sort().slice(-12);

    const labels = sortedMonths.map((m) => {
      const [year, month] = m.split('-');
      return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
    });

    const acquiredData = sortedMonths.map((m) => monthlyData.get(m)?.acquired || 0);
    const disposedData = sortedMonths.map((m) => monthlyData.get(m)?.disposed || 0);

    return {
      labels,
      datasets: [
        {
          label: 'Acquired',
          data: acquiredData,
          backgroundColor: '#10b981',
          borderRadius: 4,
        },
        {
          label: 'Disposed',
          data: disposedData,
          backgroundColor: '#dc2626',
          borderRadius: 4,
        },
      ],
    };
  }, [transactions]);

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          padding: 15,
          font: { size: 11 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `${context.dataset.label || 'Unknown'}: ${(context.parsed.y ?? 0).toLocaleString()} shares`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 }, color: '#94a3b8' },
      },
      y: {
        beginAtZero: true,
        grid: { color: '#e2e8f0' },
        ticks: {
          font: { size: 10 },
          color: '#94a3b8',
          callback: (value) => {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            return formatNumberCompact(numValue);
          },
        },
      },
    },
  };

  if (chartData.labels.length === 0) {
    return <EmptyState variant="inline" message="No transaction data available" />;
  }

  return (
    <div className="relative h-full">
      <div className="absolute top-0 right-0 z-10">
        <ExportButton onExport={handleExport} />
      </div>
      <Bar ref={chartRef} data={chartData} options={options} />
    </div>
  );
}
