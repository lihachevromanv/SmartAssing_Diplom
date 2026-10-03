import { writeFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS } from './domain.ts';
import { planGreedy, planOptimal } from './engine/assign.ts';
import { generateWorld, makeRng, runSimulation, SIM_NOW } from './simulate.ts';

/** Формирует данные для главы 3 диплома: сценарии, чувствительность к весам, масштабируемость. */
const out: Record<string, unknown> = {};

out.scenarios = [
  { employees: 8, tasks: 40 },
  { employees: 12, tasks: 60 },
  { employees: 20, tasks: 120 },
].map((sc) => ({ ...sc, result: runSimulation({ seed: 2025, runs: 30, ...sc }) }));

const variants: Record<string, typeof DEFAULT_WEIGHTS> = {
  'Базовые веса (0,35 / 0,25 / 0,20 / 0,10 / 0,10)': DEFAULT_WEIGHTS,
  'Равные веса (0,20 каждый)': { skill: 0.2, load: 0.2, deadline: 0.2, speed: 0.2, reliability: 0.2 },
  'Упор на навыки (0,70 / 0,10 / 0,10 / 0,05 / 0,05)': { skill: 0.7, load: 0.1, deadline: 0.1, speed: 0.05, reliability: 0.05 },
  'Упор на загрузку (0,10 / 0,60 / 0,15 / 0,10 / 0,05)': { skill: 0.1, load: 0.6, deadline: 0.15, speed: 0.1, reliability: 0.05 },
  'Упор на срок (0,15 / 0,15 / 0,55 / 0,10 / 0,05)': { skill: 0.15, load: 0.15, deadline: 0.55, speed: 0.1, reliability: 0.05 },
};
out.sensitivity = Object.entries(variants).map(([name, w]) => {
  const r = runSimulation({ seed: 2025, runs: 30, employees: 12, tasks: 60 }, w);
  return { name, greedy: r.strategies.find((s) => s.key === 'smart_greedy')!.metrics, optimal: r.strategies.find((s) => s.key === 'smart_optimal')!.metrics };
});

out.timing = [20, 50, 100, 200, 300].map((tasks) => {
  const world = generateWorld(makeRng(7), 20, tasks);
  const t = (fn: typeof planOptimal) => {
    const runs = 5;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) fn(world.tasks, world.employees, DEFAULT_WEIGHTS, SIM_NOW);
    return (performance.now() - t0) / runs;
  };
  return { tasks, employees: 20, greedyMs: Number(t(planGreedy).toFixed(1)), optimalMs: Number(t(planOptimal).toFixed(1)) };
});

writeFileSync(process.argv[2] ?? 'results.json', JSON.stringify(out, null, 1));
console.log('готово');
