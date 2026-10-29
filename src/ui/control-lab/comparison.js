import { conditionKey } from '../../core/index.mjs';

export function getActiveRun(experiment) {
  return experiment.runs.find(run => run.id === experiment.activeRunId) || experiment.runs.at(-1) || null;
}

export function sameRunConfiguration(a, b) {
  if (!a?.config || !b?.config) return false;
  return conditionKey(a.config) === conditionKey(b.config)
    && ['type', 'kp', 'ki', 'kd', 'tf'].every(key => a.config.controller[key] === b.config.controller[key]);
}

// Migrate older records once, skipping duplicate calculations of the current
// parameters. Explicit null is meaningful and must never cause render-time drift.
export function initializeComparison(experiment) {
  if (Object.hasOwn(experiment, 'comparisonRunId') && Object.hasOwn(experiment, 'lastManualRunId')) return experiment;
  const active = getActiveRun(experiment);
  const activeIndex = active ? experiment.runs.findIndex(run => run.id === active.id) : experiment.runs.length;
  const previous = active && experiment.runs.slice(0, activeIndex).reverse().find(run =>
    run.status === 'completed' && run.conditionKey === active.conditionKey && !sameRunConfiguration(run, active));
  return {
    ...experiment,
    comparisonRunId: Object.hasOwn(experiment, 'comparisonRunId') ? experiment.comparisonRunId : (previous?.id ?? (active?.status === 'completed' ? active.id : null)),
    lastManualRunId: Object.hasOwn(experiment, 'lastManualRunId') ? experiment.lastManualRunId : null,
  };
}

export function getComparisonRun(experiment, active = getActiveRun(experiment)) {
  if (!active || !experiment.comparisonRunId) return null;
  const baseline = experiment.runs.find(run => run.id === experiment.comparisonRunId);
  return baseline?.status === 'completed' && baseline.id !== active.id && baseline.conditionKey === active.conditionKey ? baseline : null;
}

// Only a completed, current manual request can advance an established baseline.
// Auto previews, history navigation and repeated parameters leave it untouched.
export function comparisonAfterRun(experiment, run, { automatic = false } = {}) {
  const initialized = initializeComparison(experiment);
  let comparisonRunId = initialized.comparisonRunId;
  let lastManualRunId = initialized.lastManualRunId;
  if (run.status !== 'completed') return { comparisonRunId, lastManualRunId };
  if (!comparisonRunId) comparisonRunId = run.id;
  if (!automatic) {
    const previousManual = experiment.runs.find(item => item.id === lastManualRunId && item.status === 'completed');
    if (previousManual && !sameRunConfiguration(previousManual, run)) comparisonRunId = previousManual.id;
    lastManualRunId = run.id;
  }
  return { comparisonRunId, lastManualRunId };
}
