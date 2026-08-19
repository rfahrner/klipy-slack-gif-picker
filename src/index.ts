import 'dotenv/config';
import { App } from '@slack/bolt';
import express from 'express';
import { searchKlipy } from './klipy';

const port = Number(process.env.PORT ?? 3000);
const klipyApiKey = process.env.KLIPY_API_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackAppToken = process.env.SLACK_APP_TOKEN;

if (!klipyApiKey) throw new Error('Missing KLIPY_API_KEY');
if (!slackBotToken) throw new Error('Missing SLACK_BOT_TOKEN');
if (!slackAppToken) throw new Error('Missing SLACK_APP_TOKEN');

// Local HTTP API. We will use this later for the richer GIF picker UI.
const web = express();
web.use(express.json());

web.get('/health', (_req, res) => {
  res.json({ ok: true, slack: 'socket-mode' });
});

web.get('/api/gifs/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1));

    if (!q) return res.json({ gifs: [], hasMore: false });

    const result = await searchKlipy(
      klipyApiKey,
      q,
      page,
      20,
      String(req.query.customer_id ?? 'local-user'),
      String(req.query.locale ?? 'US'),
      String(req.query.content_filter ?? 'medium')
    );

    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: 'Klipy search failed' });
  }
});

// Slack uses Socket Mode, so no public URL or tunnel is required for local development.
const slack = new App({
  token: slackBotToken,
  appToken: slackAppToken,
  socketMode: true
});

slack.command('/klipy-gif', async ({ command, ack, respond }) => {
  await ack();

  const query = command.text.trim();
  if (!query) {
    await respond({
      response_type: 'ephemeral',
      text: 'Try `/klipy-gif michael scott`.'
    });
    return;
  }

  try {
    const { gifs } = await searchKlipy(
      klipyApiKey,
      query,
      1,
      20,
      command.user_id,
      'US',
      'medium'
    );

    if (!gifs.length) {
      await respond({
        response_type: 'ephemeral',
        text: `No KLIPY GIFs found for “${query}”.`
      });
      return;
    }

    // Temporary connectivity test. The custom infinite-scroll picker replaces this next.
    const preview = gifs
      .slice(0, 5)
      .map((gif, index) => `${index + 1}. ${gif.url}`)
      .join('\n');

    await respond({
      response_type: 'ephemeral',
      text: `KLIPY results for “${query}”:\n${preview}`
    });
  } catch (error) {
    console.error(error);
    await respond({
      response_type: 'ephemeral',
      text: 'KLIPY search failed. Check the terminal for the error.'
    });
  }
});

async function start() {
  web.listen(port, () => {
    console.log(`Local GIF API: http://localhost:${port}`);
  });

  await slack.start();
  console.log('⚡ Slack Socket Mode connected');
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
