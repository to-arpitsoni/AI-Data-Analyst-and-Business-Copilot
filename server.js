import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/gemini', aiRateLimit, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'AI is not configured. Using the local analysis engine.' });
  }

  const { contents, systemInstruction } = req.body ?? {};
  const validContents =
    Array.isArray(contents) &&
    contents.length > 0 &&
    contents.length <= 12 &&
    contents.every(
      (entry) =>
        ['user', 'model'].includes(entry?.role) &&
        Array.isArray(entry.parts) &&
        entry.parts.length > 0 &&
        entry.parts.every((part) => typeof part?.text === 'string'),
    );

  if (
    !validContents ||
    typeof systemInstruction !== 'string' ||
    systemInstruction.length > 200_000
  ) {
    return res.status(400).json({ error: 'Invalid AI request.' });
  }

  const promptSize = contents.reduce(
    (size, entry) => size + entry.parts.reduce((entrySize, part) => entrySize + part.text.length, 0),
    0,
  );
  if (promptSize > 500_000) {
    return res.status(413).json({ error: 'AI request is too large.' });
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  );
  endpoint.searchParams.set('key', apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`Gemini request failed with status ${response.status}.`);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429 ? 'AI rate limit reached.' : 'AI service request failed.',
      });
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      console.error('Gemini returned no text content.');
      return res.status(502).json({ error: 'AI service returned an empty response.' });
    }

    return res.json({ text: text.trim(), model });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    console.error(timedOut ? 'Gemini request timed out.' : 'Gemini request could not be completed.');
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'AI service timed out.' : 'AI service is unavailable.',
    });
  } finally {
    clearTimeout(timeout);
  }
});

const distPath = path.join(projectRoot, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (error) => {
    if (error) res.status(404).send('Build the website first with npm run build.');
  });
});

app.listen(port, host, () => {
  console.log(`AI Data Analyst server listening on http://${host}:${port}`);
});
