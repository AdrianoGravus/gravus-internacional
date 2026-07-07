import { fetchGlobalData } from '@/lib/fetchers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fetchGlobalData();
    return Response.json(data, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error('Error fetching data:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
