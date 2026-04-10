import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

const DEFAULT_SITEMAP_URL =
  "https://test-1111111111111111111111111111111111711111111111128302.myshopify.com/sitemap.xml";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const requestUrl = new URL(request.url);
  const sitemapUrl = requestUrl.searchParams.get("url") ?? DEFAULT_SITEMAP_URL;

  let parsedSitemapUrl: URL;
  try {
    parsedSitemapUrl = new URL(sitemapUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid sitemap URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    parsedSitemapUrl.protocol !== "https:" ||
    !parsedSitemapUrl.hostname.endsWith(".myshopify.com") ||
    !parsedSitemapUrl.pathname.endsWith("/sitemap.xml")
  ) {
    return new Response(JSON.stringify({ error: "Sitemap URL is not allowed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upstreamResponse = await fetch(parsedSitemapUrl.toString(), {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "internal-project-testing-sitemap-proxy/1.0",
    },
  });

  if (!upstreamResponse.ok) {
    return new Response(
      JSON.stringify({
        error: `Failed to fetch sitemap (${upstreamResponse.status})`,
      }),
      {
        status: upstreamResponse.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstreamResponse.headers.get("content-type") ?? "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};