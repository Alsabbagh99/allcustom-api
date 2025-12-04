// api/list-product-handles.js

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
          "Missing environment variables. Check SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN.",
      });
    }

    const query = `
      query listProducts {
        products(first: 100) {
          edges {
            node {
              id
              handle
              title
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
      console.error("Shopify listProducts error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify API error when listing products",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const edges = shopifyJson.data?.products?.edges || [];
    const products = edges.map((e) => e.node);

    return res.status(200).json({
      ok: true,
      count: products.length,
      products,
    });
  } catch (err) {
    console.error("Unexpected error in /api/list-product-handles:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
