import type { APIRoute } from "astro";
import { getHealth } from "../app/ops/health";

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getHealth()), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
