function fitLine(points) {
  const count = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.actual, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.actual, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = count * sumXX - sumX * sumX;
  const slope = denominator ? (count * sumXY - sumX * sumY) / denominator : 0;
  return { slope, intercept: (sumY - slope * sumX) / count };
}

export function computeForecast(rows, labelCol, targetCol, horizon = 4) {
  const points = rows
    .map((row, index) => ({
      x: index + 1,
      label: labelCol ? String(row[labelCol]) : `Period ${index + 1}`,
      actual: Number(row[targetCol]),
    }))
    .filter((point) => Number.isFinite(point.actual));

  if (points.length < 2 || !targetCol) return null;

  const safeHorizon = Math.max(1, Math.min(24, Math.trunc(Number(horizon) || 4)));
  const { slope, intercept } = fitLine(points);
  const mean = points.reduce((sum, point) => sum + point.actual, 0) / points.length;
  let totalSquares = 0;
  let residualSquares = 0;

  const combinedSeries = points.map((point) => {
    const trend = slope * point.x + intercept;
    totalSquares += (point.actual - mean) ** 2;
    residualSquares += (point.actual - trend) ** 2;
    return {
      period: point.label,
      actual: point.actual,
      trend: Number(trend.toFixed(2)),
      forecast: null,
      upperBound: null,
      lowerBound: null,
    };
  });

  const rSquared =
    totalSquares > 0 ? Math.max(0, Math.min(1, 1 - residualSquares / totalSquares)) : 0;
  const stdError =
    points.length > 2
      ? Math.sqrt(residualSquares / (points.length - 2))
      : Math.abs(mean) * 0.08;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const sumSquaredX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);

  const validationCount =
    points.length >= 5 ? Math.min(3, Math.max(1, Math.floor(points.length * 0.2))) : 0;
  const validationErrors = [];
  const percentageErrors = [];

  for (let index = points.length - validationCount; index < points.length; index += 1) {
    if (index < 2) continue;
    const validationModel = fitLine(points.slice(0, index));
    const predicted = validationModel.slope * points[index].x + validationModel.intercept;
    const error = Math.abs(points[index].actual - predicted);
    validationErrors.push(error);
    if (points[index].actual !== 0) {
      percentageErrors.push(error / Math.abs(points[index].actual));
    }
  }

  const lastPoint = combinedSeries[combinedSeries.length - 1];
  lastPoint.forecast = lastPoint.actual;

  const futurePredictions = [];
  for (let step = 1; step <= safeHorizon; step += 1) {
    const futureX = points.length + step;
    const predicted = Math.max(0, slope * futureX + intercept);
    const leverage = sumSquaredX
      ? (futureX - meanX) ** 2 / sumSquaredX
      : 0;
    const margin = 1.28 * stdError * Math.sqrt(1 + 1 / points.length + leverage);
    const entry = {
      period: `Forecast +${step}`,
      actual: null,
      trend: Number(predicted.toFixed(2)),
      forecast: Number(predicted.toFixed(2)),
      upperBound: Number((predicted + margin).toFixed(2)),
      lowerBound: Number(Math.max(0, predicted - margin).toFixed(2)),
    };
    combinedSeries.push(entry);
    futurePredictions.push(entry);
  }

  const lastActual = points[points.length - 1].actual;
  const finalForecast = futurePredictions[futurePredictions.length - 1].forecast;
  const projectedGrowthPct =
    lastActual !== 0 ? ((finalForecast - lastActual) / Math.abs(lastActual)) * 100 : 0;

  return {
    slope: Number(slope.toFixed(2)),
    intercept: Number(intercept.toFixed(2)),
    rSquared: Number(rSquared.toFixed(3)),
    projectedGrowthPct: Number(projectedGrowthPct.toFixed(1)),
    backtest: {
      periods: validationErrors.length,
      mae: validationErrors.length
        ? Number(
            (validationErrors.reduce((sum, error) => sum + error, 0) / validationErrors.length).toFixed(2),
          )
        : null,
      mape: percentageErrors.length
        ? Number(
            (
              (percentageErrors.reduce((sum, error) => sum + error, 0) /
                percentageErrors.length) *
              100
            ).toFixed(1),
          )
        : null,
    },
    combinedSeries,
    futurePredictions,
  };
}
