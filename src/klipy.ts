export interface KlipyGif { id: string; title: string; url: string; previewUrl: string; width?: number; height?: number; }

const API_BASE = 'https://api.klipy.com/api/v1';

export async function searchKlipy(apiKey: string, q: string, page = 1, perPage = 20, customerId = 'slack-user', locale = 'US', contentFilter = 'medium') {
  const url = new URL(`${API_BASE}/${encodeURIComponent(apiKey)}/gifs/search`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('q', q);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('locale', locale);
  url.searchParams.set('content_filter', contentFilter);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Klipy returned ${response.status}`);
  const body: any = await response.json();
  const raw = Array.isArray(body.results) ? body.results : Array.isArray(body.data) ? body.data : [];

  const gifs: KlipyGif[] = raw.map((item: any, i: number) => {
    const media = item.media_formats ?? item.images ?? item.media ?? {};
    const gif = media.gif ?? media.gifpreview ?? media.original ?? media.preview ?? media;
    const preview = media.tinygif ?? media.mediumgif ?? media.gifpreview ?? gif;
    return {
      id: String(item.id ?? item.content_id ?? `${page}-${i}`),
      title: item.title ?? item.name ?? item.content_description ?? '',
      url: gif?.url ?? item.url ?? item.gif_url ?? item.media_url ?? '',
      previewUrl: preview?.url ?? gif?.url ?? item.preview_url ?? item.url ?? '',
      width: Number(gif?.dims?.[0] ?? gif?.width ?? 0) || undefined,
      height: Number(gif?.dims?.[1] ?? gif?.height ?? 0) || undefined
    };
  }).filter((g: KlipyGif) => g.url && g.previewUrl);

  return { gifs, hasMore: Boolean(body.next || body.pagination?.next) || raw.length >= perPage };
}
