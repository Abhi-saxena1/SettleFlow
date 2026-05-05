import { apiErrorResponse, handleSettleFlowApi } from "../../../lib/server/settleflowApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request, context) {
  try {
    const data = await handleSettleFlowApi(request, context.params.path || []);
    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
