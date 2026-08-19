export interface KlipyGif {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
}

const API_BASE = 'https://api.klipy.com/api/v1';

export async function searchKlipy(
  apiKey: string,
  q: string,
  page = 1,
  perPage = 20,
  customerId = 'slack-user',
  locale = 'US',
  contentFilter = 'medium'
): Promise<{ gifs: KlipyGif[]; hasMore: boolean }> {
  const url = new URL(`${API_BASE}/${encodeURIComponent(apiKey)}/gifs/search`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('q', q);
  url.searchParams.set('customer_id', customerId);
  url.searchParams.set('locale', locale);
  url.searchParams.set('content_filter', contentFilter);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'klipy-slack-gif-picker/0.1'
    }
  });

  if (!response.ok) {
    throw new Error(`Klipy returned ${response.status}: ${await response.text()}`);
  }

  const body: any = await response.json();

  // KLIPY v1 wraps search results under data.data.
  // Keep a few fallbacks so the client stays resilient if the API shape evolves.
  const raw: any[] = Array.isArray(body?.data?.data)
    ? body.data.data
    : Array.isArray(body?.data?.items)
      ? body.data.items
      : Array.isArray(body?.results)
        ? body.results
        : Array.isArray(body?.data)
          ? body.data
          : [];

  const gifs: KlipyGif[] = raw
    .map((item: any, i: number) => {
      // Current KLIPY v1 media lives under file.{hd,md,sm,xs}.{gif,webp,...}
      const file = item?.file ?? {};
      const full = file?.md?.gif ?? file?.hd?.gif ?? file?.sm?.gif ?? file?.xs?.gif;
      const preview =
        file?.sm?.gif ??
        file?.sm?.webp ??
        file?.xs?.gif ??
        file?.xs?.webp ??
        full;

      // Compatibility fallbacks for Tenor-like response variants.
      const media = item?.media_formats ?? item?.images ?? item?.media ?? {};
      const legacyFull = media?.gif ?? media?.gifpreview ?? media?.original ?? media?.preview ?? media;
      const legacyPreview = media?.tinygif ?? media?.mediumgif ?? media?.gifpreview ?? legacyFull;

      const fullUrl = full?.url ?? legacyFull?.url ?? item?.url ?? item?.gif_url ?? item?.media_url ?? '';
      const previewUrl = preview?.url ?? legacyPreview?.url ?? item?.preview_url ?? fullUrl;

      return {
        id: String(item?.id ?? item?.content_id ?? item?.slug ?? `${page}-${i}`),
        title: item?.title ?? item?.name ?? item?.content_description ?? item?.slug ?? '',
        url: fullUrl,
        previewUrl,
        width: Number(full?.width ?? legacyFull?.dims?.[0] ?? legacyFull?.width ?? 0) || undefined,
        height: Number(full?.height ?? legacyFull?.dims?.[1] ?? legacyFull?.height ?? 0) || undefined
      };
    })
    .filter((gif: KlipyGif) => Boolean(gif.url && gif.previewUrl));

  const hasMore =
    body?.data?.has_next === true ||
    Boolean(body?.data?.next_page) ||
    Boolean(body?.next) ||
    Boolean(body?.pagination?.next) ||
    raw.length >= perPage;

  return { gifs, hasMore };
}
