import Papa from 'papaparse';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function parseCSV(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('The CSV file is empty.');
  }

  if (new TextEncoder().encode(csvText).length > MAX_FILE_SIZE) {
    throw new Error('CSV files must be 10 MB or smaller.');
  }

  const headerResult = Papa.parse(csvText, {
    preview: 1,
    skipEmptyLines: 'greedy',
  });
  const sourceHeaders = (headerResult.data[0] || []).map((header) => String(header).trim());
  if (new Set(sourceHeaders).size !== sourceHeaders.length) {
    throw new Error('CSV column names must be unique.');
  }

  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const fatalError = result.errors.find(
    (error) => error.code === 'MissingQuotes' || error.code === 'TooManyFields',
  );
  if (fatalError) {
    throw new Error(`Could not parse CSV near row ${fatalError.row + 1}: ${fatalError.message}`);
  }

  if (Object.keys(result.meta.renamedHeaders || {}).length > 0) {
    throw new Error('CSV column names must be unique.');
  }

  const headers = result.meta.fields || [];
  if (!headers.length || headers.some((header) => !header)) {
    throw new Error('The CSV must have a header row with non-empty column names.');
  }

  const rows = result.data
    .filter((row) => Object.values(row).some((value) => String(value ?? '').trim() !== ''))
    .map((row) =>
      Object.fromEntries(headers.map((header) => [header, String(row[header] ?? '').trim()])),
    );

  if (!rows.length) {
    throw new Error('The CSV must contain at least one data row.');
  }

  return { headers, rows };
}
