import { runSimulation } from './simulate.ts';

/** Серия экспериментов: сравнение стратегий распределения на синтетических данных разного масштаба. */
const scenarios = [
  { employees: 8, tasks: 40 },
  { employees: 12, tasks: 60 },
  { employees: 20, tasks: 120 },
];

for (const sc of scenarios) {
  const t0 = performance.now();
  const res = runSimulation({ seed: 2025, runs: 30, ...sc });
  const ms = performance.now() - t0;
  console.log(`\n=== Сотрудников: ${sc.employees}, задач: ${sc.tasks}, прогонов: 30 (расчёт ${ms.toFixed(0)} мс) ===`);
  console.table(
    res.strategies.map((s) => ({
      Стратегия: s.label,
      'Несоответствие навыков, %': s.metrics.mismatchRate,
      'Просрочено, %': s.metrics.lateRate,
      'Крит. просрочено, %': s.metrics.criticalLateRate,
      'Ср. опоздание, дн.': s.metrics.avgLatenessDays,
      'σ загрузки, п.п.': s.metrics.loadStd,
      'Макс. загрузка, %': s.metrics.maxLoad,
      'Срок завершения, дн.': s.metrics.makespanDays,
      'Соответствие навыков': s.metrics.avgSkillMatch,
    })),
  );
}
