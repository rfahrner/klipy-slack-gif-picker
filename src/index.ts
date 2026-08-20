import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { App } from '@slack/bolt';
import express from 'express';
import { searchKlipy, type KlipyGif } from './klipy';
import { getRecentGifs, rememberGif } from './recent';

const port = Number(process.env.PORT ?? 3000);
const klipyApiKey = process.env.KLIPY_API_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackAppToken = process.env.SLACK_APP_TOKEN;
const BATCH_SIZE = 9;
const MAX_MODAL_GIFS = 90;

if (!klipyApiKey) throw new Error('Missing KLIPY_API_KEY');
if (!slackBotToken) throw new Error('Missing SLACK_BOT_TOKEN');
if (!slackAppToken) throw new Error('Missing SLACK_APP_TOKEN');

const web = express();
web.get('/health', (_req, res) => {
  res.json({ ok: true, slack: 'socket-mode', picker: 'modal-card' });
});

type PickerMode = 'recent' | 'search';

type PickerSession = {
  id: string;
  userId: string;
  channelId: string;
  mode: PickerMode;
  query: string;
  page: number;
  recentOffset: number;
  gifs: KlipyGif[];
  hasMore: boolean;
  createdAt: number;
};

const sessions = new Map<string, PickerSession>();

function cleanupSessions() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}

function safeLabel(value: string, fallback = 'GIF') {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  return (clean || fallback).slice(0, 140);
}

function pickerView(session: PickerSession): any {
  const blocks: any[] = [
    {
      type: 'input',
      block_id: `gif-search-${session.id}-${Date.now()}`,
      dispatch_action: true,
      optional: true,
      label: { type: 'plain_text', text: 'Search', emoji: true },
      element: {
        type: 'plain_text_input',
        action_id: 'modal_gif_search',
        initial_value: session.query,
        placeholder: { type: 'plain_text', text: 'Search GIFs and press Enter' },
        dispatch_action_config: { trigger_actions_on: ['on_enter_pressed'] }
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          session.mode === 'recent'
            ? '*Recently used*'
            : `*Results for:* ${session.query.replace(/[<>]/g, '')}`
      }
    }
  ];

  if (!session.gifs.length) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            session.mode === 'recent'
              ? 'No recent GIFs yet. Search above to find your first one.'
              : 'No GIFs found. Try a different search.'
        }
      ]
    });
  } else {
    session.gifs.forEach((gif, index) => {
      blocks.push({
        type: 'card',
        block_id: `gif-card-${session.id}-${index}-${Date.now()}`,
        hero_image: {
          type: 'image',
          image_url: gif.previewUrl || gif.url,
          alt_text: safeLabel(gif.title, `GIF ${index + 1}`)
        },
        actions: {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'modal_gif_preview',
              value: JSON.stringify({ sessionId: session.id, index }),
              text: { type: 'plain_text', text: 'Open', emoji: true }
            }
          ]
        }
      });
    });
  }

  if (session.hasMore && session.gifs.length < MAX_MODAL_GIFS) {
    blocks.push({
      type: 'actions',
      block_id: `gif-more-${session.id}-${Date.now()}`,
      elements: [
        {
          type: 'button',
          action_id: 'modal_gif_load_more',
          value: session.id,
          text: { type: 'plain_text', text: 'Load 9 more', emoji: true }
        }
      ]
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Powered by KLIPY_' }]
  });

  return {
    type: 'modal',
    callback_id: 'klipy_picker_modal',
    private_metadata: session.id,
    title: { type: 'plain_text', text: 'KLIPY GIFs' },
    close: { type: 'plain_text', text: 'Close' },
    blocks
  };
}

function previewView(session: PickerSession, index: number): any {
  const gif = session.gifs[index];
  return {
    type: 'modal',
    callback_id: 'gif_preview_modal',
    private_metadata: JSON.stringify({
      sessionId: session.id,
      index,
      channelId: session.channelId,
      userId: session.userId
    }),
    title: { type: 'plain_text', text: 'GIF Preview' },
    close: { type: 'plain_text', text: 'Cancel' },
    submit: { type: 'plain_text', text: 'Send GIF' },
    blocks: [
      {
        type: 'image',
        image_url: gif.url,
        alt_text: safeLabel(gif.title, 'KLIPY GIF preview')
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_Powered by KLIPY_' }]
      }
    ]
  };
}

async function loadFirstBatch(session: PickerSession) {
  if (session.mode === 'recent') {
    const result = getRecentGifs(session.userId, 0, BATCH_SIZE);
    session.gifs = result.gifs;
    session.recentOffset = result.gifs.length;
    session.hasMore = result.hasMore;
    return;
  }

  const result = await searchKlipy(
    klipyApiKey,
    session.query,
    1,
    BATCH_SIZE,
    session.userId,
    'US',
    'medium'
  );
  session.gifs = result.gifs;
  session.page = 2;
  session.hasMore = result.hasMore;
}

async function loadMore(session: PickerSession) {
  if (!session.hasMore || session.gifs.length >= MAX_MODAL_GIFS) return;

  if (session.mode === 'recent') {
    const result = getRecentGifs(session.userId, session.recentOffset, BATCH_SIZE);
    session.gifs.push(...result.gifs.slice(0, MAX_MODAL_GIFS - session.gifs.length));
    session.recentOffset += result.gifs.length;
    session.hasMore = result.hasMore && session.gifs.length < MAX_MODAL_GIFS;
    return;
  }

  const result = await searchKlipy(
    klipyApiKey,
    session.query,
    session.page,
    BATCH_SIZE,
    session.userId,
    'US',
    'medium'
  );
  session.gifs.push(...result.gifs.slice(0, MAX_MODAL_GIFS - session.gifs.length));
  session.page += 1;
  session.hasMore = result.hasMore && session.gifs.length < MAX_MODAL_GIFS;
}

const slack = new App({
  token: slackBotToken,
  appToken: slackAppToken,
  socketMode: true
});

slack.command('/klipy-gif', async ({ command, ack, client }) => {
  await ack();
  cleanupSessions();

  const query = command.text.trim();
  const session: PickerSession = {
    id: randomUUID(),
    userId: command.user_id,
    channelId: command.channel_id,
    mode: query ? 'search' : 'recent',
    query,
    page: 1,
    recentOffset: 0,
    gifs: [],
    hasMore: false,
    createdAt: Date.now()
  };

  sessions.set(session.id, session);

  try {
    await loadFirstBatch(session);
    await client.views.open({
      trigger_id: command.trigger_id,
      view: pickerView(session)
    });
  } catch (error) {
    console.error('Failed to open KLIPY picker:', error);
  }
});

slack.action('modal_gif_search', async ({ ack, action, body, client }) => {
  await ack();

  const view = (body as any).view;
  if (!view?.id) return;

  const sessionId = String(view.private_metadata ?? '');
  const session = sessions.get(sessionId);
  if (!session || session.userId !== (body as any).user?.id) return;

  const query = String((action as any).value ?? '').trim();
  session.query = query;
  session.mode = query ? 'search' : 'recent';
  session.page = 1;
  session.recentOffset = 0;
  session.gifs = [];
  session.hasMore = false;
  session.createdAt = Date.now();

  try {
    await loadFirstBatch(session);
    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: pickerView(session)
    });
  } catch (error) {
    console.error('Modal search failed:', error);
  }
});

slack.action('modal_gif_load_more', async ({ ack, body, client }) => {
  await ack();

  const view = (body as any).view;
  if (!view?.id) return;

  const sessionId = String(view.private_metadata ?? '');
  const session = sessions.get(sessionId);
  if (!session || session.userId !== (body as any).user?.id) return;

  try {
    await loadMore(session);
    session.createdAt = Date.now();
    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: pickerView(session)
    });
  } catch (error) {
    console.error('Could not load more GIFs:', error);
  }
});

slack.action('modal_gif_preview', async ({ ack, action, body, client }) => {
  await ack();

  let payload: { sessionId: string; index: number };
  try {
    payload = JSON.parse(String((action as any).value ?? '{}'));
  } catch {
    return;
  }

  const session = sessions.get(payload.sessionId);
  const gif = session?.gifs[payload.index];
  if (!session || !gif || session.userId !== (body as any).user?.id) return;

  const triggerId = (body as any).trigger_id;
  if (!triggerId) return;

  try {
    await client.views.push({
      trigger_id: triggerId,
      view: previewView(session, payload.index)
    });
  } catch (error) {
    console.error('Could not open GIF preview:', error);
  }
});

slack.view('gif_preview_modal', async ({ ack, view, client }) => {
  let metadata: {
    sessionId: string;
    index: number;
    channelId: string;
    userId: string;
  };

  try {
    metadata = JSON.parse(view.private_metadata || '{}');
  } catch {
    await ack();
    return;
  }

  const session = sessions.get(metadata.sessionId);
  const gif = session?.gifs[metadata.index];

  if (!session || !gif || session.userId !== metadata.userId) {
    await ack();
    return;
  }

  await ack();

  try {
    await client.chat.postMessage({
      channel: metadata.channelId,
      text: gif.url,
      unfurl_links: true,
      unfurl_media: true
    });
    rememberGif(metadata.userId, gif);
  } catch (error) {
    console.error('Failed to send selected GIF:', error);
  }
});

async function start() {
  web.listen(port, () => console.log(`Health check: http://localhost:${port}/health`));
  await slack.start();
  console.log('⚡ Slack Socket Mode connected — modal card picker ready (up to 90 GIFs)');
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
