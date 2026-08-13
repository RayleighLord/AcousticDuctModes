const SERIES_ARGUMENT_LIMIT = 16;
const MAX_SERIES_ITERATIONS = 512;
const MAX_ASYMPTOTIC_TERMS = 96;

function assertIntegerOrder(order: number): void {
  if (!Number.isInteger(order) || !Number.isFinite(order)) {
    throw new TypeError("Bessel order must be a finite integer.");
  }
}

function assertFiniteArgument(x: number): void {
  if (!Number.isFinite(x)) {
    throw new TypeError("Bessel argument must be finite.");
  }
}

/** Convergent power series for non-negative integer order and x >= 0. */
function besselJSeries(order: number, x: number): number {
  if (x === 0) {
    return order === 0 ? 1 : 0;
  }

  let term = 1;
  const halfX = x / 2;
  for (let factor = 1; factor <= order; factor += 1) {
    term *= halfX / factor;
  }

  let sum = term;
  let compensation = 0;
  const multiplier = -(x * x) / 4;

  for (let k = 1; k <= MAX_SERIES_ITERATIONS; k += 1) {
    term *= multiplier / (k * (order + k));

    // Neumaier/Kahan-style compensated accumulation limits cancellation near
    // the larger roots for which alternating terms are individually sizeable.
    const corrected = term - compensation;
    const next = sum + corrected;
    compensation = (next - sum) - corrected;
    sum = next;

    if (Math.abs(term) <= Number.EPSILON * Math.max(1, Math.abs(sum))) {
      return sum;
    }
  }

  return sum;
}

/**
 * Poincare expansion for J_0 and J_1. It is used only for x > 16, where the
 * terms decrease far below double-precision resolution before truncation.
 */
function besselJAsymptotic(order: 0 | 1, x: number): number {
  const mu = 4 * order * order;
  let coefficient = 1;
  let evenSeries = 1;
  let oddSeries = 0;
  let previousMagnitude = Number.POSITIVE_INFINITY;

  for (let k = 1; k <= MAX_ASYMPTOTIC_TERMS; k += 1) {
    const nextCoefficient = coefficient
      * (mu - (2 * k - 1) ** 2)
      / (k * 8 * x);
    const magnitude = Math.abs(nextCoefficient);

    // An asymptotic series is optimally truncated immediately before its
    // terms begin to grow again.
    if (magnitude > previousMagnitude) {
      break;
    }

    coefficient = nextCoefficient;
    previousMagnitude = magnitude;
    if (k % 2 === 0) {
      evenSeries += (-1) ** (k / 2) * coefficient;
    } else {
      oddSeries += (-1) ** ((k - 1) / 2) * coefficient;
    }
  }

  const phase = x - order * Math.PI / 2 - Math.PI / 4;
  return Math.sqrt(2 / (Math.PI * x))
    * (Math.cos(phase) * evenSeries - Math.sin(phase) * oddSeries);
}

function besselJNonNegativeOrder(order: number, x: number): number {
  if (x === 0) {
    return order === 0 ? 1 : 0;
  }

  // The series is accurate and naturally regular at the axis. It is also the
  // stable choice when the order exceeds the argument.
  if (x <= SERIES_ARGUMENT_LIMIT || order > x) {
    return besselJSeries(order, x);
  }

  let previous = besselJAsymptotic(0, x);
  if (order === 0) {
    return previous;
  }

  let current = besselJAsymptotic(1, x);
  for (let k = 1; k < order; k += 1) {
    const next = (2 * k / x) * current - previous;
    previous = current;
    current = next;
  }
  return current;
}

/** Cylindrical Bessel J for a finite integer order and real finite argument. */
export function besselJInteger(order: number, x: number): number {
  assertIntegerOrder(order);
  assertFiniteArgument(x);

  const absoluteOrder = Math.abs(order);
  const absoluteX = Math.abs(x);
  let sign = 1;
  if (order < 0 && absoluteOrder % 2 === 1) {
    sign *= -1;
  }
  if (x < 0 && absoluteOrder % 2 === 1) {
    sign *= -1;
  }

  return sign * besselJNonNegativeOrder(absoluteOrder, absoluteX);
}

/** Derivative with respect to x, evaluated through the exact recurrence. */
export function besselJDerivative(order: number, x: number): number {
  assertIntegerOrder(order);
  assertFiniteArgument(x);
  return 0.5 * (
    besselJInteger(order - 1, x) - besselJInteger(order + 1, x)
  );
}
