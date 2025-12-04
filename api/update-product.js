// api/update-product.js

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use POST." });
    }

    const { productId, descriptionHtml, seoTitle, seoDescription } = req.body || {};

    if (!productId || !descriptionHtml) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: productId and descriptionHtml",
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

    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            descriptionHtml
            seo {
              title
              description
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: productId,
        descriptionHtml,
        seo: {
          title: seoTitle || null,
          description: seoDescription || null,
        },
      },
    };

    const shopifyRes = await fetch(
      `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": adminToken,
        },
        body: JSON.stringify({ query: mutation, variables }),
      }
    );

    const shopifyJson = await shopifyRes.json();

    if (!shopifyRes.ok || shopifyJson.errors) {
      console.error("Shopify productUpdate error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify productUpdate API error",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const result = shopifyJson.data?.productUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Shopify productUpdate userErrors",
        userErrors,
      });
    }

    return res.status(200).json({
      ok: true,
      product: result?.product || null,
    });
  } catch (err) {
    console.error("Unexpected error in /api/update-product:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
