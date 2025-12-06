// api/list-blogs.js
const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed. Use GET." });
  }

  try {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!storeDomain || !adminToken) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing environment variables. Check SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.",
      });
    }

    const endpoint = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/blogs.json`;

    const shopifyRes = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
    });

    const data = await shopifyRes.json().catch(() => null);

    if (!shopifyRes.ok) {
      console.error("Shopify REST list blogs error:", shopifyRes.status, data);
      return res.status(500).json({
        ok: false,
        error: "Shopify REST list blogs error",
        status: shopifyRes.status,
        details: data,
      });
    }

    const blogs = (data.blogs || []).map((b) => ({
      id: b.id,
      title: b.title,
      handle: b.handle,
    }));

    return res.status(200).json({
      ok: true,
      count: blogs.length,
      blogs,
    });
  } catch (err) {
    console.error("Unexpected error in /api/list-blogs:", err);
    return res.status(500).json({
      ok: false,
      error: "Unexpected server error",
      details: String(err),
    });
  }
}
