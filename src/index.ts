import 'dotenv/config';
import { App } from '@slack/bolt';
import express from 'express';
import { searchKlipy, type KlipyGif } from './klipy';
import { getRecentGifs, rememberGif } from './recent';

const port = Number(process.env.PORT ?? 3000);
const klipyApiKey = process.env.KLIPY_API_KEY;
const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackAppToken = process.env.SLACK_APP_TOKEN;

if (!klipyApiKey) throw new Error('Missing KLIPY_API_KEY');
if (!slackBotToken) throw new Error('Missing SLACK_BOT_TOKEN');
if (!slackAppToken) throw new Error('Missing SLACK_APP_TOKEN');

const web = express();
web.use(express.json({ limit: '1mb' }));

web.get('/health', (_req, res) => {
  res.json({ ok: true, slack: 'socket-mode' });
});

web.get('/api/gifs/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const userId = String(req.query.user_id ?? 'local-user');
    if (!q) return res.json({ gifs: [], hasMore: false });

    const result = await searchKlipy(
      klipyApiKey,
      q,
      page,
      20,
      userId,
      String(req.query.locale ?? 'US'),
      String(req.query.content_filter ?? 'medium')
    );
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: 'Klipy search failed' });
  }
});

web.get('/api/gifs/recent', (req, res) => {
  const userId = String(req.query.user_id ?? 'local-user');
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  return res.json(getRecentGifs(userId, offset, 20));
});

const slack = new App({
  token: slackBotToken,
  appToken: slackAppToken,
  socketMode: true
});

web.post('/api/gifs/send', async (req, res) => {
  try {
    const { channelId, userId, gif } = req.body as {
      channelId?: string;
      userId?: string;
      gif?: KlipyGif;
    };

    if (!channelId || !userId || !gif?.url || !gif?.id) {
      return res.status(400).json({ error: 'channelId, userId and gif are required' });
    }

    await slack.client.chat.postMessage({ channel: channelId, text: gif.url });
    rememberGif(userId, gif);
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to send GIF to Slack' });
  }
});

web.get('/picker', (req, res) => {
  const userId = String(req.query.user_id ?? 'local-user');
  const channelId = String(req.query.channel_id ?? '');
  const initialQuery = String(req.query.q ?? '');

  res.type('html').send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>KLIPY GIF Picker</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:Inter,Arial,sans-serif;background:#111;color:#fff}
  header{position:sticky;top:0;background:#111;padding:16px;border-bottom:1px solid #2c2c2c;z-index:10}
  input{width:100%;padding:14px 16px;border-radius:10px;border:1px solid #444;background:#1d1d1d;color:#fff;font-size:16px}
  #label{padding:16px 16px 0;font-weight:700;color:#ddd}
  #grid{padding:16px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .card{background:#1c1c1c;border-radius:10px;overflow:hidden;cursor:pointer;min-height:120px;display:flex;align-items:center;justify-content:center}
  .card img{width:100%;height:180px;object-fit:cover;display:block}
  #sentinel{height:60px;display:flex;align-items:center;justify-content:center;color:#aaa}
  #modal{position:fixed;inset:0;background:rgba(0,0,0,.78);display:none;align-items:center;justify-content:center;z-index:50;padding:24px}
  #modal.open{display:flex}.panel{max-width:min(900px,95vw);max-height:92vh;background:#181818;border-radius:14px;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.55)}
  .panel img{display:block;max-width:80vw;max-height:70vh;min-width:min(640px,75vw);object-fit:contain;margin:auto}
  .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}.actions button{padding:11px 16px;border:0;border-radius:8px;cursor:pointer;font-weight:700}
  .send{background:#4a154b;color:#fff}.copy{background:#eee;color:#111}.close{background:#333;color:#fff}
  #status{padding:0 16px 12px;color:#9ad}
  @media(max-width:900px){#grid{grid-template-columns:repeat(3,1fr)}.card img{height:160px}}
  @media(max-width:650px){#grid{grid-template-columns:repeat(2,1fr)}.card img{height:150px}.panel img{min-width:0;max-width:90vw}}
</style>
</head>
<body>
<header><input id="search" placeholder="Search KLIPY GIFs…" value="${initialQuery.replace(/"/g,'&quot;')}" /></header>
<div id="label">Recently used</div><div id="status"></div><main id="grid"></main><div id="sentinel">Scroll for more</div>
<div id="modal"><div class="panel"><img id="preview" alt="GIF preview"/><div class="actions"><button class="close" id="close">Close</button><button class="copy" id="copy">Copy GIF link</button><button class="send" id="send">Send GIF</button></div></div></div>
<script>
const USER_ID=${JSON.stringify(userId)}; const CHANNEL_ID=${JSON.stringify(channelId)};
let mode='recent', query='', page=1, offset=0, loading=false, hasMore=true, selected=null, generation=0;
const grid=document.getElementById('grid'), search=document.getElementById('search'), label=document.getElementById('label'), status=document.getElementById('status');
function card(gif){const d=document.createElement('div');d.className='card';const img=document.createElement('img');img.src=gif.previewUrl||gif.url;img.alt=gif.title||'GIF';img.loading='lazy';d.appendChild(img);d.onclick=()=>openPreview(gif);return d}
function append(gifs){for(const gif of gifs) grid.appendChild(card(gif))}
function reset(){grid.innerHTML='';page=1;offset=0;hasMore=true;generation++;}
async function load(){if(loading||!hasMore)return;loading=true;status.textContent='Loading…';const g=generation;try{let u;if(mode==='recent'){u='/api/gifs/recent?user_id='+encodeURIComponent(USER_ID)+'&offset='+offset}else{u='/api/gifs/search?user_id='+encodeURIComponent(USER_ID)+'&page='+page+'&q='+encodeURIComponent(query)}const r=await fetch(u);const data=await r.json();if(g!==generation)return;append(data.gifs||[]);hasMore=!!data.hasMore;if(mode==='recent')offset+=(data.gifs||[]).length;else page++;status.textContent=(data.gifs||[]).length?'':'No GIFs found';}catch(e){status.textContent='Could not load GIFs';console.error(e)}finally{loading=false}}
let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{query=search.value.trim();mode=query?'search':'recent';label.textContent=query?'Search results':'Recently used';reset();load()},350)});
function openPreview(gif){selected=gif;document.getElementById('preview').src=gif.url;document.getElementById('modal').classList.add('open')}
document.getElementById('close').onclick=()=>document.getElementById('modal').classList.remove('open');
document.getElementById('modal').onclick=(e)=>{if(e.target.id==='modal')e.currentTarget.classList.remove('open')};
document.getElementById('copy').onclick=async()=>{if(selected)await navigator.clipboard.writeText(selected.url)};
document.getElementById('send').onclick=async()=>{if(!selected||!CHANNEL_ID)return;status.textContent='Sending…';const r=await fetch('/api/gifs/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:CHANNEL_ID,userId:USER_ID,gif:selected})});if(r.ok){status.textContent='Sent to Slack';document.getElementById('modal').classList.remove('open')}else status.textContent='Send failed'};
const io=new IntersectionObserver((entries)=>{if(entries[0].isIntersecting)load()},{rootMargin:'900px'});io.observe(document.getElementById('sentinel'));
if(search.value.trim()){query=search.value.trim();mode='search';label.textContent='Search results'}load();
</script>
</body>
</html>`);
});

slack.command('/klipy-gif', async ({ command, ack, respond }) => {
  await ack();
  const query = command.text.trim();
  const params = new URLSearchParams({ user_id: command.user_id, channel_id: command.channel_id });
  if (query) params.set('q', query);
  const pickerUrl = `http://localhost:${port}/picker?${params.toString()}`;

  await respond({
    response_type: 'ephemeral',
    text: query
      ? `Open the KLIPY picker for “${query}”: ${pickerUrl}`
      : `Open the KLIPY picker: ${pickerUrl}`
  });
});

async function start() {
  web.listen(port, () => console.log(`Local GIF picker: http://localhost:${port}/picker`));
  await slack.start();
  console.log('⚡ Slack Socket Mode connected');
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
