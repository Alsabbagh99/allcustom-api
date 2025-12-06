// api/update-collection-seo.js

const SHOPIFY_API_VERSION = "2024-07";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed. Use POST." });
    }

    const { collectionId, seoTitle, seoDescription } = req.body || {};

    if (!collectionId) {
      return res.status(400).json({
        ok: false,
        error: "Missing required field: collectionId",
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
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
            title
            handle
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
        id: collectionId,
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
      console.error("Shopify collectionUpdate error:", shopifyJson);
      return res.status(500).json({
        ok: false,
        error: "Shopify collectionUpdate API error",
        details: shopifyJson.errors || shopifyJson,
      });
    }

    const result = shopifyJson.data?.collectionUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Shopify collectionUpdate userErrors",
        userErrors,
      });
    }

    return res.status(200).json({
      ok: true,
      collection: result?.collection || null,
    });
  } catch (err) {
    console.error("Unexpected error in /api/update-collection-seo:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Unexpected server error" });
  }
}
