// lookup.js — free, keyless product lookup by barcode via Open Food Facts.
// Note: Open Food Facts has no concept of expiration date (that's specific to
// the physical item you bought), so expiration is always entered by hand.

async function lookupProduct(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    let category = null;
    if (Array.isArray(p.categories_tags) && p.categories_tags.length) {
      const last = p.categories_tags[p.categories_tags.length - 1];
      category = last
        .replace(/^\w+:/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return {
      name: p.product_name || p.generic_name || "Unnamed Product",
      brand: p.brands || null,
      category,
      imageUrl: p.image_url || null,
    };
  } catch (err) {
    console.warn("Product lookup failed:", err);
    return null;
  }
}
