// api/list-collections.js

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use GET." });
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

    // Get up to 50 collections (you probably have far less)
    const query = `
      query listCollections {
        collections(first: 50) {
          edges {
            node {
              id
              handle
              title
              description
              seo {
                title
                description
              }
            }
          }
        }
      }
    `;

    const shopifyRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({ query }),
      }
    );

    const shopifyJson = await shopifyRes.json();

    if (!shopifyRes.ok || shopifyJson.errors) {
      console.error("Shopify listCollections error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when listing collections",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const edges = shopifyJson.data?.collections?.edges || [];
    const collections = edges.map((e) => e.node);

    return res.status(200).json({
      ok: true,
      count: collections.length,
      collections,
    });
  } catch (err) {
    console.error("Unexpected error in /api/list-collections:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
