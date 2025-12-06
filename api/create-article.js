// api/create-article.js
const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed. Use POST." });
  }

  try {
    const {
      blogId,          // numeric blog id
      title,
      bodyHtml,        // full HTML of the article
      tags,            // optional array of tags
      author,          // optional author name
      seoTitle,        // optional SEO title
      seoDescription,  // optional SEO description
    } = req.body || {};

    if (!blogId || !title || !bodyHtml) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: blogId, title, bodyHtml",
      });
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

    const endpoint = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${blogId}/articles.json`;

    const articlePayload = {
      title,
      body_html: bodyHtml,
    };

    if (author) articlePayload.author = author;
    if (tags && Array.isArray(tags) && tags.length > 0) {
      articlePayload.tags = tags.join(", ");
    }
    if (seoTitle) articlePayload.metafields_global_title_tag = seoTitle;
    if (seoDescription)
      articlePayload.metafields_global_description_tag = seoDescription;

    const shopifyRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ article: articlePayload }),
    });

    const data = await shopifyRes.json().catch(() => null);

    if (!shopifyRes.ok) {
      console.error("Shopify REST create article error:", shopifyRes.status, data);
      return res.status(500).json({
        ok: false,
        error: "Shopify REST create article error",
        status: shopifyRes.status,
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      article: data.article || null,
    });
  } catch (err) {
    console.error("Unexpected error in /api/create-article:", err);
    return res.status(500).json({
      ok: false,
      error: "Unexpected server error",
      details: String(err),
    });
  }
}
