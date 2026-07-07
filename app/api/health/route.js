export async function GET() {
  return Response.json({ status: 'ok', service: 'gravus-internacional', time: new Date().toISOString() });
}
