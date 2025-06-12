// pages/api/startOrderListener.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_TABLE_NAME = process.env.SUPABASE_TABLE_NAME || 'live_products';
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { post_id, message } = req.body;

  if (typeof post_id !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'post_id 和 message 是必填字段' });
  }

  const match = message.match(/\b[Bb]\s*0*(\d{1,3})[\s\-_:]*([\u4e00-\u9fa5A-Za-z0-9]+)[\s\-_:]*RM\s*([\d,.]+)/);

  if (!match) {
    return res.status(400).json({ error: 'message 格式不合规定' });
  }

  const [, numberRaw, product_name, priceRaw] = match;
  const selling_id = 'B' + numberRaw.padStart(3, '0');

  const price_raw = parseFloat(priceRaw.replace(/,/g, ''));
  const price_fmt = price_raw.toFixed(2);

  const { data, error } = await supabase
    .from(SUPABASE_TABLE_NAME)
    .insert([{ post_id, selling_id, product_name, price_raw: price_fmt, price_fmt }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, product: { selling_id, product_name, price_raw: price_fmt, price_fmt } });
}
