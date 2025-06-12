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

  // 解析留言格式：例如 “B01 黄杨矮霸 RM320.00”
  const regex = /[bB]\s*0*(\d+)[^\da-zA-Z]*([\u4e00-\u9fa5\w\s\-]+)[^\d]*(?:RM|rm)?\s*([\d,.]+)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '留言格式无效，无法识别商品信息' });
  }

  const number = match[1]; // 提取编号（纯数字）
  const productName = match[2].trim(); // 商品名
  const rawPrice = match[3].replace(/,/g, ''); // 去除千分位逗号
  const priceFloat = parseFloat(rawPrice).toFixed(2);

  const sellingId = 'B' + number.padStart(3, '0'); // 输出格式如 B001、B199

  // 插入到 Supabase 表
  const { data, error } = await supabase
    .from(process.env.SUPABASE_TABLE_NAME)
    .insert([
      {
        post_id,
        selling_id: sellingId,
        product_name: productName,
        price_raw: priceFloat,
        price_fmt: parseFloat(priceFloat).toLocaleString('en-MY', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
      },
    ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, product: data[0] });
}
