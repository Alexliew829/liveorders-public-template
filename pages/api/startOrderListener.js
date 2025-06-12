import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { post_id, message } = req.body;

  if (!post_id || !message || typeof post_id !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'post_id 和 message 是必填字段' });
  }

  // 正则提取编号、名称、价格
  const regex = /(B\s*\d{1,4})[\s\-_/]*([\u4e00-\u9fa5A-Za-z\d\s]{1,30})[^\d]*(?:RM|rm)?\s*([\d.,]+)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '留言格式无法解析', raw: message });
  }

  try {
    // 编号处理为三位数
    const raw_id = match[1].toUpperCase().replace(/\s+/g, '').replace('B', '');
    const selling_id = 'B' + raw_id.padStart(3, '0');

    const product_name = match[2].trim().replace(/^[^\w\u4e00-\u9fa5]+/, '');

    const raw_price = match[3].replace(/[^\d.]/g, '');
    const price = parseFloat(raw_price);
    const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const { error } = await supabase.from(process.env.SUPABASE_TABLE_NAME).insert({
      selling_id,
      post_id,
      product_name,
      price_raw: price.toFixed(2),
      price_fmt
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true, product: { selling_id, product_name, price_raw: price.toFixed(2), price_fmt } });
  } catch (e) {
    return res.status(500).json({ error: '处理失败', detail: e.message });
  }
}
