// pages/api/addProduct.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractProductInfo(message) {
  const idMatch = message.match(/\b[bB]\s*0*(\d{1,3})\b/);
  if (!idMatch) return null;
  const sellingId = `B${idMatch[1]}`.padStart(3, '0');

  const priceMatch = message.match(/(?:RM|rm|Rm|rM)[\s\-~_]*([\d,\.]+)/);
  const rawPrice = priceMatch?.[1]?.replace(/,/g, '') || '';
  const priceFloat = parseFloat(rawPrice);
  const priceFmt = priceFloat.toLocaleString('en-MY', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const productName = message
    .replace(idMatch[0], '')
    .replace(priceMatch?.[0] || '', '')
    .trim();

  return {
    selling_id: sellingId,
    product_name: productName,
    price_raw: rawPrice,
    price_fmt: priceFmt
  };
}

export default async function handler(req, res) {
  const { post_id, message } = req.body;

  if (!post_id || !message) {
    return res.status(400).json({ error: 'post_id 和 message 是必填字段' });
  }

  const product = extractProductInfo(message);

  if (!product) {
    return res.status(400).json({ error: '无法识别产品留言格式' });
  }

  try {
    const { error } = await supabase.from('live_products').insert({
      ...product,
      post_id,
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    return res.status(200).json({ success: true, product });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
