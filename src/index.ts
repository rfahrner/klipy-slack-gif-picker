import 'dotenv/config';
import express from 'express';
import { searchKlipy } from './klipy';

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.KLIPY_API_KEY;
if (!apiKey) console.warn('KLIPY_API_KEY is not set. Add it locally or as a deployment secret.');

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/gifs/search', async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: 'Klipy API key is not configured' });
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    if (!q) return res.json({ gifs: [], hasMore: false });
    const result = await searchKlipy(apiKey, q, page, 20, String(req.query.customer_id ?? 'slack-user'), String(req.query.locale ?? 'US'), String(req.query.content_filter ?? 'medium'));
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'Klipy search failed' });
  }
});

app.listen(port, () => console.log(`Klipy GIF API listening on ${port}`));
