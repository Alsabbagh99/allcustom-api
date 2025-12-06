// api/update-article-seo.js
const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed. Use POST." });
  }

  try {
    const { articleId, seoTitle, seoDescription } = req.body || {};

    if (!articleId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing required field: articleId" });
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!storeDomain || !adminToken) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing environment variables. Check SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.",
      });
    }

    // Convert GID -> numeric ID for REST
    const numericId = String(articleId).includes("gid://")
      ? String(articleId).split("/").pop()
      : String(articleId);

    const endpoint = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/articles/${numericId}.json`;

    const shopifyRes = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({
        article: {
          id: Number(numericId),
          metafields_global_title_tag: seoTitle || null,
          metafields_global_description_tag: seoDescription || null,
        },
      }),
    });

    const data = await shopifyRes.json().catch(() => null);

    if (!shopifyRes.ok) {
      console.error("Shopify REST article update error:", shopifyRes.status, data);
      return res.status(500).json({
        ok: false,
        error: "Shopify REST article update error",
        status: shopifyRes.status,
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      article: data?.article || null,
    });
  } catch (err) {
    console.error("Unexpected error in /api/update-article-seo:", err);
    return res.status(500).json({
      ok: false,
      error: "Unexpected server error",
      details: String(err),
    });
  }
}
