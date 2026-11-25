# AI Data Analyst & Business Intelligence Copilot (AIDS451)

**Submitted By:** Arpit Soni (Roll No.: 03296211923, Sem: 7th, Sec: F-20)  
**Under the Supervision of:** Dr. Ankur Jain, Associate Professor  
**Department of Artificial Intelligence and Data Science**  
**Dr. Akhilesh Das Gupta Institute of Professional Studies (GGSIPU, Delhi)**

---

## Deploy on Streamlit Community Cloud

The repository includes a Streamlit-native entrypoint at `app.py`. To deploy it:

1. Make sure the project is pushed to your GitHub repository.
2. Sign in at [share.streamlit.io](https://share.streamlit.io/) with GitHub and choose **Create app**.
3. Select `to-arpitsoni/AI-Data-Analyst-and-Business-Copilot`, branch `main`, and main file path `app.py`.
4. Choose **Deploy**. Streamlit installs dependencies from `requirements.txt`.
5. To enable Gemini answers, open the deployed app's **Settings → Secrets** and add:
   ```toml
   GEMINI_API_KEY = "your-google-ai-studio-key"
   ```
   Keep this key in Streamlit secrets; do not commit it to the repository.

The Streamlit version provides CSV upload, data-quality cleanup, statistics, charts, forecasts, and an AI copilot with a local fallback. The React/Vite website remains available separately.

## Quick Start in VS Code

1. Install web dependencies:
   ```bash
   npm install
   ```
2. (Optional) Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
   The key stays on the Node server; never add a `VITE_` prefix. The app uses its built-in analytical engine if no key is configured.
3. Start the website and API:
   ```bash
   npm run dev
   ```
   The Vite website runs at `http://127.0.0.1:5173`.
4. Run automated data parser and forecast tests:
   ```bash
   npm test
   ```
5. Build and run the production server:
   ```bash
   npm run build
   npm start
   ```
   The production app runs on port `3001` by default; set `PORT` when your host provides a different port.

## Data handling

- CSV uploads are processed in the browser and are limited to 10 MB.
- CSV fields with quoted commas and escaped quotes are supported. Invalid headers and malformed rows are rejected with an upload error.
- Gemini requests are sent through the Node server, rate-limited to 30 requests per IP every 15 minutes. Keep the server-side API key private. For a public multi-user deployment, add user authentication and per-user quotas before enabling paid AI access.
- Forecast accuracy is reported using a small walk-forward holdout (up to three recent records). This is a diagnostic, not a guarantee of future performance.
